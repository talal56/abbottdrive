// controllers/driverController.js
// Lets a driver go online or offline and share their location.
// This writes to the DriverStatus collection, which matchingService reads.

const User = require('../models/User')
const Vehicle = require('../models/Vehicle')
const DriverStatus = require('../models/DriverStatus')

// Checks a location is [longitude, latitude] with real numbers in range
const isValidCoordinates = (coords) => {
    if (!Array.isArray(coords) || coords.length !== 2) return false
    const [lng, lat] = coords
    return typeof lng === 'number' && typeof lat === 'number' &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
}

// ---------------------------------------------------------------
// DRIVER: go online or offline
// Body: { "isOnline": true, "coordinates": [longitude, latitude] }
// Coordinates are required to go online, and optional to go offline.
// ---------------------------------------------------------------
const setStatus = async (req, res) => {
    try {
        const driverId = req.user.id
        const { isOnline, coordinates } = req.body

        // 1) isOnline must be exactly true or false
        if (typeof isOnline !== 'boolean') {
            return res.status(400).json({ error: 'isOnline must be true or false' })
        }

        // 2) Look for the driver's current status record (it may not exist yet)
        const existing = await DriverStatus.findOne({ driver: driverId })

        // ---------------------------------------------------------
        // GOING OFFLINE
        // ---------------------------------------------------------
        if (!isOnline) {
            // A driver in the middle of a ride cannot disappear
            if (existing && existing.currentRide) {
                return res.status(400).json({ error: 'Finish or cancel your current ride before going offline' })
            }

            // If the driver never went online, there is nothing to switch off
            if (!existing) {
                return res.status(200).json({ status: { isOnline: false } })
            }

            existing.isOnline = false
            existing.lastSeenAt = new Date()
            await existing.save()

            return res.status(200).json({ status: { isOnline: false } })
        }

        // ---------------------------------------------------------
        // GOING ONLINE
        // ---------------------------------------------------------
        // 3) A location is needed so matching knows where the driver is
        if (!isValidCoordinates(coordinates)) {
            return res.status(400).json({ error: 'Valid coordinates [longitude, latitude] are required to go online' })
        }

        // 4) The driver must be verified by an admin
        const driver = await User.findById(driverId)
        if (!driver || !driver.isDriverVerified) {
            return res.status(403).json({ error: 'Driver is not verified' })
        }

        // 5) The driver must have an APPROVED vehicle that is allowed to work today.
        // FIXED: we load ALL approved vehicles, then ask each one "canTakeRides()".
        // That method (in Vehicle.js) also checks the registration deadline
        // of "applied" vehicles, so the rule lives in one place only.
        const approvedVehicles = await Vehicle.find({ driver: driverId, status: 'approved' })
        if (approvedVehicles.length === 0) {
            return res.status(403).json({ error: 'No approved vehicle found' })
        }

        // FIXED: pick the first approved vehicle that may work right now
        const vehicle = approvedVehicles.find((v) => v.canTakeRides())
        if (!vehicle) {
            // The vehicle is approved, but the deadline for its plate number has passed
            return res.status(403).json({ error: 'Your vehicle registration deadline has passed. Add your registration number to go online' })
        }

        // 6) Save the status. "upsert" means: update the record if it exists,
        //    or create it if this is the driver's first time online.
        //    We do NOT touch currentRide here, so a driver who is already
        //    on a ride keeps it.
        const status = await DriverStatus.findOneAndUpdate(
            { driver: driverId },
            {
                isOnline: true,
                location: { type: 'Point', coordinates },
                vehicle: vehicle._id,
                lastSeenAt: new Date(),
            },
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
        )

        res.status(200).json({
            status: {
                isOnline: status.isOnline,
                location: status.location.coordinates,
                vehicleType: vehicle.vehicleType,
            },
        })
    } catch (err) {
        console.error('setStatus error:', err)
        res.status(500).json({ error: 'Failed to update driver status' })
    }
}

// ---------------------------------------------------------------
// NEW. DRIVER: send the current location over plain HTTP.
// POST /api/driver/location
// Body: { "coordinates": [longitude, latitude] }
//
// This is the BACKUP for the socket event driver:location. When the phone
// screen is off, sockets are unreliable, so the background task in the app
// sends the location here instead. The rules are the same as the socket
// version in sockets/driverSocket.js:
//   - the driver must be verified (checked in MongoDB, not only in the token)
//   - the driver must be online (checked inside the update itself)
//   - the location comes from the body; the ride id never does
// ---------------------------------------------------------------
const updateLocation = async (req, res) => {
    try {
        const driverId = req.user.id
        // locationValidation already checked the shape and range of coordinates
        const { coordinates } = req.body

        // 1) Is this driver really verified by an admin? The token can be up to
        //    15 minutes old, so we ask MongoDB (known issues 12 and 13).
        const driver = await User.findById(driverId).select('isDriverVerified')
        if (!driver || !driver.isDriverVerified) {
            return res.status(403).json({ error: 'Driver is not verified' })
        }

        // 2) Save the location, but ONLY if the driver is online.
        //    The filter { isOnline: true } and the update are one atomic step.
        //    An offline driver matches nothing and we get null.
        const status = await DriverStatus.findOneAndUpdate(
            { driver: driverId, isOnline: true },
            {
                $set: {
                    location: { type: 'Point', coordinates: [coordinates[0], coordinates[1]] },
                    lastSeenAt: new Date(),
                },
            },
            { returnDocument: 'after' }
        )
        if (!status) {
            return res.status(409).json({ error: 'Go online first (PATCH /api/driver/status)' })
        }

        // 3) If the driver is on a ride, pass the location to the ride room,
        //    exactly like the socket version does. The ride id comes from OUR
        //    database (status.currentRide), never from the request.
        //    A socket problem must never turn a saved location into an error.
        const io = req.app.get('io')
        if (io && status.currentRide) {
            try {
                io.to(`ride:${status.currentRide}`).emit('driver:location', {
                    rideId: status.currentRide,
                    coordinates: status.location.coordinates,
                    at: new Date().toISOString(),
                })
            } catch (emitErr) {
                console.error('updateLocation emit error:', emitErr.message)
            }
        }

        res.status(200).json({ ok: true })
    } catch (err) {
        console.error('updateLocation error:', err)
        res.status(500).json({ error: 'Failed to update location' })
    }
}

module.exports = { setStatus, updateLocation } // NEW: updateLocation added