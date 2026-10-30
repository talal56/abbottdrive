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

        // 5) The driver must have a vehicle verified by an admin
        const vehicle = await Vehicle.findOne({ driver: driverId, verified: true })
        if (!vehicle) {
            return res.status(403).json({ error: 'No verified vehicle found' })
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
            { new: true, upsert: true, setDefaultsOnInsert: true }
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

module.exports = { setStatus }