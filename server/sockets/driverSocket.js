// sockets/driverSocket.js
// NEW FILE. Handles the driver's live location over the socket.
// sockets/index.js calls it once for every connected socket:
//     require('./driverSocket')(io, socket)
//
// The app sends:   socket.emit('driver:location', { coordinates: [lng, lat] }, callback)
//   - coordinates is [longitude, latitude], the same order as the database
//   - callback is optional but recommended: the server answers { ok: true }
//     or { ok: false, error: '...' } so the app knows what happened
//
// Analogy: the driver radios in "I am here". The dispatcher first checks the
// caller really is a verified driver who is on shift, and only then updates the map.

const User = require('../models/User')
const DriverStatus = require('../models/DriverStatus')

// The fastest we accept updates from ONE socket (1 per second).
// A normal app sends one every 5 seconds, so this only stops floods.
// NEW. [TO CONFIRM] value. It may move into Settings in option F.
const MIN_UPDATE_INTERVAL_MS = 1000

// ---------------------------------------------------------------
// Helper: checks a location is [longitude, latitude] with real numbers
// in the right range. Same rule as driverController, but stricter:
// Number.isFinite also rejects NaN and Infinity.
// Valid example: [73.2215, 34.1688]  (Abbottabad)
// Invalid examples: [34.1688], [999, 0], ['73.2', '34.1'], null
// ---------------------------------------------------------------
const isValidCoordinates = (coords) => {
    if (!Array.isArray(coords) || coords.length !== 2) return false
    const [lng, lat] = coords
    return Number.isFinite(lng) && Number.isFinite(lat) &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
}

// ---------------------------------------------------------------
// The function sockets/index.js calls for every new connection.
// io     : the whole Socket.io server (used to send to a ride room)
// socket : this ONE connection. socket.user = { id, roles, exp } from socketAuth
// ---------------------------------------------------------------
module.exports = (io, socket) => {
    const driverId = socket.user.id

    // When this socket last sent an accepted update (for the speed limit)
    let lastUpdateAt = 0

    socket.on('driver:location', async (payload, ack) => {
        // Helper: answer through the callback, but only if the app sent one.
        // Without this check, a missing callback would crash the handler.
        const reply = (result) => {
            if (typeof ack === 'function') ack(result)
        }

        try {
            // 1) Quick check from the token: only accounts with the driver role.
            //    This costs nothing. The real check against MongoDB is in step 4.
            if (!socket.user.roles.includes('driver')) {
                return reply({ ok: false, error: 'Only drivers can send location' })
            }

            // 2) Speed limit: ignore updates that come too fast.
            //    We save the time BEFORE the database calls, so two updates
            //    arriving together cannot both pass.
            const now = Date.now()
            if (now - lastUpdateAt < MIN_UPDATE_INTERVAL_MS) {
                return reply({ ok: false, error: 'Sending location too fast' })
            }
            lastUpdateAt = now

            // 3) Check the payload. We take ONLY "coordinates" from it.
            //    We ignore any "rideId" the app sends: a driver must not be able
            //    to push their location into a ride that is not theirs.
            const coordinates = payload && payload.coordinates
            if (!isValidCoordinates(coordinates)) {
                return reply({ ok: false, error: 'coordinates must be [longitude, latitude]' })
            }

            // 4) Ask MongoDB: is this driver really verified by an admin?
            //    The token's roles can be up to 15 minutes old, so we do not
            //    trust the token alone (known issues 12 and 13 in the handoff).
            const driver = await User.findById(driverId).select('isDriverVerified')
            if (!driver || !driver.isDriverVerified) {
                return reply({ ok: false, error: 'Driver is not verified' })
            }

            // 5) Save the new location, but ONLY if the driver is online.
            //    The filter { isOnline: true } and the update are one atomic step.
            //    If the driver is offline, nothing matches and we get null.
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
                return reply({ ok: false, error: 'Go online first (PATCH /api/driver/status)' })
            }

            // 6) If the driver is on a ride, pass the location to the ride room.
            //    The ride id comes from OUR database (status.currentRide), never
            //    from the app. The rider is in this room after ride:join (step 5).
            if (status.currentRide) {
                io.to(`ride:${status.currentRide}`).emit('driver:location', {
                    rideId: status.currentRide,
                    coordinates: status.location.coordinates,
                    at: new Date().toISOString(),
                })
            }

            // 7) Tell the app it worked
            return reply({ ok: true })
        } catch (err) {
            // Details stay in the server log. The app gets a short message.
            console.error(`driver:location error for driver ${driverId}:`, err.message)
            return reply({ ok: false, error: 'Failed to update location' })
        }
    })
}