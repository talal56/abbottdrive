// sockets/rideSocket.js
// NEW FILE. Handles three events about one ride:
//   ride:join    the rider or the assigned driver joins the ride's private room
//   ride:leave   they leave that room
//   ride:decline a driver says "I cannot take this ride" (needs step 6)
//
// sockets/index.js calls it once for every connected socket:
//     require('./rideSocket')(io, socket)
//
// Analogy: a ride room is a private radio channel for ONE trip.
// Only the rider and the driver of that trip are allowed on it.
//
// NOTE about "ride status events": ride:status and ride:accepted are sent
// BY THE SERVER from rideController (step 6), because the status changes
// happen through the HTTP routes. This file only lets people into the room.

const mongoose = require('mongoose')
const Ride = require('../models/Ride')
const matchingService = require('../services/matchingService')

// A ride in one of these statuses can still have a live room.
// Finished or cancelled rides have nothing left to follow.
const ACTIVE_STATUSES = ['requested', 'accepted', 'arriving', 'in-progress']

// The most ride rooms ONE socket may be in at the same time.
// A normal user is in 1. This stops someone collecting rooms.
// NEW. [TO CONFIRM] value.
const MAX_RIDE_ROOMS = 5

// ---------------------------------------------------------------
// Helper: the room name for a ride, for example ride:66f1...
// Step 4 (driverSocket) and step 6 (rideController) use the same name.
// ---------------------------------------------------------------
const rideRoom = (rideId) => `ride:${rideId}`

// ---------------------------------------------------------------
// Helper: is this a real ride id (text in the shape of a MongoDB id)?
// ---------------------------------------------------------------
const isValidRideId = (rideId) => {
    return typeof rideId === 'string' && mongoose.isValidObjectId(rideId)
}

// ---------------------------------------------------------------
// The function sockets/index.js calls for every new connection.
// io     : the whole Socket.io server (decline needs it, to notify drivers)
// socket : this ONE connection. socket.user = { id, roles, exp }
// ---------------------------------------------------------------
module.exports = (io, socket) => {
    const userId = socket.user.id

    // Helper: answer through the callback, only if the app sent one
    const reply = (ack, result) => {
        if (typeof ack === 'function') ack(result)
    }

    // -----------------------------------------------------------
    // ride:join   payload: { rideId }
    // The app sends it after booking, and AGAIN after every reconnect,
    // because a socket that drops is removed from all its rooms.
    // -----------------------------------------------------------
    socket.on('ride:join', async (payload, ack) => {
        try {
            // 1) The ride id must look like a real id
            const rideId = payload && payload.rideId
            if (!isValidRideId(rideId)) {
                return reply(ack, { ok: false, error: 'Invalid ride id' })
            }

            // 2) Load only the fields we need. We never load the OTP.
            const ride = await Ride.findById(rideId).select('rider driver status')

            // 3) Only the rider or the assigned driver may join.
            //    "Not found" and "not yours" get the SAME answer, so nobody
            //    can find out which ride ids exist.
            const isRider = ride && ride.rider.toString() === userId
            const isDriver = ride && ride.driver && ride.driver.toString() === userId
            if (!ride || (!isRider && !isDriver)) {
                return reply(ack, { ok: false, error: 'Ride not found' })
            }

            // 4) Finished or cancelled rides have no live room
            if (!ACTIVE_STATUSES.includes(ride.status)) {
                return reply(ack, { ok: false, error: `This ride is ${ride.status}` })
            }

            // 5) Limit how many ride rooms one socket can hold.
            //    socket.rooms also contains the socket's own id and user:<id>,
            //    so we count only the names that start with "ride:".
            const room = rideRoom(rideId)
            const rideRooms = [...socket.rooms].filter((name) => name.startsWith('ride:'))
            if (!rideRooms.includes(room) && rideRooms.length >= MAX_RIDE_ROOMS) {
                return reply(ack, { ok: false, error: 'Too many active rides' })
            }

            // 6) Let them in. Joining twice is harmless.
            socket.join(room)

            // 7) Send back the CURRENT status. After a weak-signal reconnect the
            //    app may have missed ride:status events, so this is how it catches up.
            return reply(ack, { ok: true, rideId, status: ride.status })
        } catch (err) {
            console.error(`ride:join error for user ${userId}:`, err.message)
            return reply(ack, { ok: false, error: 'Failed to join ride' })
        }
    })

    // -----------------------------------------------------------
    // ride:leave   payload: { rideId }
    // Leaving a room you are not in does nothing, so no database check is needed.
    // -----------------------------------------------------------
    socket.on('ride:leave', (payload, ack) => {
        const rideId = payload && payload.rideId
        if (!isValidRideId(rideId)) {
            return reply(ack, { ok: false, error: 'Invalid ride id' })
        }

        socket.leave(rideRoom(rideId))
        return reply(ack, { ok: true })
    })

    // -----------------------------------------------------------
    // ride:decline   payload: { rideId }
    // A driver says "I cannot take this ride".
    // The REAL work (is this driver one of the drivers offered the ride?
    // pass the ride on) lives in matchingService, which keeps the list of
    // who was offered what. We add matchingService.declineOffer in step 6.
    // -----------------------------------------------------------
    socket.on('ride:decline', async (payload, ack) => {
        try {
            // 1) Quick check from the token: only accounts with the driver role
            if (!socket.user.roles.includes('driver')) {
                return reply(ack, { ok: false, error: 'Only drivers can decline rides' })
            }

            // 2) The ride id must look like a real id
            const rideId = payload && payload.rideId
            if (!isValidRideId(rideId)) {
                return reply(ack, { ok: false, error: 'Invalid ride id' })
            }

            // 3) matchingService checks the driver was really offered this ride.
            //    It answers { ok: true } or { ok: false, error: '...' }.
            const result = await matchingService.declineOffer(io, rideId, userId)
            return reply(ack, result)
        } catch (err) {
            console.error(`ride:decline error for user ${userId}:`, err.message)
            return reply(ack, { ok: false, error: 'Failed to decline ride' })
        }
    })
}