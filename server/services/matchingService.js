// services/matchingService.js
// Finds drivers for a ride request AND runs the "offer" process:
//   - sends ride:request to the nearest 3 drivers at once, with a countdown
//   - a decline or a timeout passes the ride to the next 3 drivers
//   - if nobody is left, the ride is cancelled (atomic: only if still "requested")
// It searches the DriverStatus collection (NOT Ride), because that is
// where each driver's live location is stored.

const crypto = require('crypto')                        // NEW: random ids for each batch
const DriverStatus = require('../models/DriverStatus')
const Ride = require('../models/Ride')                  // NEW: to read and update the ride

const MAX_DISTANCE_KM = 5   // only drivers within 5 km of the pickup point
const SEARCH_LIMIT = 50     // how many nearby candidates we load before filtering
const RESULT_LIMIT = 10     // how many drivers we return at most (default)

// ---------------------------------------------------------------
// NEW. Settings for the offer process.
// [TO CONFIRM] values. They move into the Settings model in option F.
// ---------------------------------------------------------------
const OFFER_BATCH_SIZE = 3        // how many drivers get the request at once
const OFFER_TIMEOUT_SEC = 20      // seconds a driver has to answer (the countdown)
const DRIVER_STALE_MS = 3 * 60 * 1000 // a driver not heard from for 3 minutes is skipped (weak signal)

// ---------------------------------------------------------------
// NEW. Who is currently being offered which ride. Kept in server memory.
//   key   : rideId (text)
//   value : { batchId, pending: Set of driverId (text), timer, expiresAt }
// "pending" = drivers who got the request and have not answered yet.
// KNOWN LIMITATION: this Map and its timers are lost if the server
// restarts, so a "requested" ride can get stuck. Fix later (cleanup job).
// ---------------------------------------------------------------
const offers = new Map()

// ---------------------------------------------------------------
// Helper: straight-line distance between two points, in km.
// MongoDB sorts drivers by distance for us, but it does not tell us the
// number, so we work it out with the "haversine" formula.
// Both points are [longitude, latitude], the same order as in the database.
// ---------------------------------------------------------------
const distanceKmBetween = (pointA, pointB) => {
    const EARTH_RADIUS_KM = 6371
    const toRadians = (degrees) => (degrees * Math.PI) / 180

    const [lng1, lat1] = pointA
    const [lng2, lat2] = pointB

    const dLat = toRadians(lat2 - lat1)
    const dLng = toRadians(lng2 - lng1)

    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2

    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ---------------------------------------------------------------
// Main search function (used by the offer process below).
// Input : pickupCoords = [longitude, latitude], vehicleType = 'bike' | 'rickshaw' | 'car' | 'van'
//         excludeDriverIds = drivers to skip (those who already had their turn)   // NEW
//         limit = how many drivers to return at most                              // NEW
// Output: an array of nearby drivers, nearest first
// ---------------------------------------------------------------
const findNearbyDrivers = async (pickupCoords, vehicleType, excludeDriverIds = [], limit = RESULT_LIMIT) => {
    // 1) Check the pickup point is [number, number]
    if (!Array.isArray(pickupCoords) || pickupCoords.length !== 2 ||
        typeof pickupCoords[0] !== 'number' || typeof pickupCoords[1] !== 'number') {
        throw new Error('pickupCoords must be [longitude, latitude]')
    }

    // 2) Ask MongoDB for drivers who are:
    //    - online
    //    - not on another ride (currentRide is empty)
    //    - NEW: not in the "already had their turn" list
    //    - NEW: heard from recently (lastSeenAt), so we do not offer a ride
    //      to a phone that lost its signal a long time ago
    //    - within 5 km of the pickup point
    //    $near also sorts the results, nearest first.
    //    $maxDistance is in METRES, so we multiply km by 1000.
    const candidates = await DriverStatus.find({
        isOnline: true,
        currentRide: null,
        driver: { $nin: excludeDriverIds },                              // NEW
        lastSeenAt: { $gte: new Date(Date.now() - DRIVER_STALE_MS) },    // NEW
        location: {
            $near: {
                $geometry: { type: 'Point', coordinates: pickupCoords },
                $maxDistance: MAX_DISTANCE_KM * 1000,
            },
        },
    })
        .limit(SEARCH_LIMIT)
        .populate('driver', 'name isDriverVerified') // never load the password or phone
        .populate('vehicle') // the full vehicle document, so canTakeRides() is available

    // 3) Keep only the candidates that pass the checks MongoDB could not do:
    //    - the driver was verified by an admin
    //    - the vehicle is approved AND allowed to work today (canTakeRides)
    //    - the vehicle is the type the rider asked for
    //    We use a normal loop (not .filter) so each step is easy to read.
    const matches = []

    for (const status of candidates) {
        // Skip if the user record or vehicle record is missing (deleted data)
        if (!status.driver || !status.vehicle) continue

        if (!status.driver.isDriverVerified) continue
        if (!status.vehicle.canTakeRides()) continue
        if (status.vehicle.vehicleType !== vehicleType) continue

        matches.push({
            driverId: status.driver._id,
            name: status.driver.name,
            vehicle: {
                id: status.vehicle._id,
                model: status.vehicle.model,
                vehicleType: status.vehicle.vehicleType,
            },
            location: status.location.coordinates,
            distanceKm: Math.round(distanceKmBetween(pickupCoords, status.location.coordinates) * 100) / 100,
        })

        // FIXED: was RESULT_LIMIT. Stop once we have as many as the caller asked for.
        if (matches.length === limit) break
    }

    // The list is already nearest first, because MongoDB sorted it for us
    return matches
}

// ---------------------------------------------------------------
// NEW. Cancel a ride that nobody accepted.
// ATOMIC: the update works only if the ride is STILL "requested".
// If a driver accepted a moment ago, the filter does not match, nothing
// changes, and the accept wins. A late accept and this timeout can never collide.
// Returns true if WE cancelled it, false if it was not "requested" any more.
// ---------------------------------------------------------------
const cancelUnaccepted = async (io, rideId, reason) => {
    const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: 'requested' },
        { $set: { status: 'cancelled', cancellationFee: 0 } },
        { returnDocument: 'after' }
    )
    if (!ride) {
        return false // someone accepted or cancelled first: nothing to do
    }

    // Tell the rider (personal room, because the rider may not be in a ride room)
    io.to(`user:${ride.rider}`).emit('ride:cancelled', {
        rideId: ride._id,
        reason, // 'no-driver'
    })
    return true
}

// ---------------------------------------------------------------
// NEW. Offer the ride to the next batch of drivers (up to 3 at once).
// Returns the drivers who were offered the ride (an empty list if none).
// ---------------------------------------------------------------
const sendNextBatch = async (io, rideId) => {
    // 1) Load the ride, including the "already had their turn" list.
    //    If it is not "requested" any more, stop: the work is over.
    const ride = await Ride.findById(rideId).select('+declinedBy')
    if (!ride || ride.status !== 'requested') {
        return []
    }

    // 2) Find up to 3 drivers who have not had their turn yet
    const drivers = await findNearbyDrivers(
        ride.pickupLocation.coordinates,
        ride.vehicleTypeRequested,
        ride.declinedBy || [],
        OFFER_BATCH_SIZE
    )

    // 3) Nobody left to ask: cancel the ride (atomic, see cancelUnaccepted)
    if (drivers.length === 0) {
        await cancelUnaccepted(io, rideId, 'no-driver')
        return []
    }

    // 4) Remember this batch and start the countdown.
    //    batchId lets the timer know whether it still belongs to the CURRENT batch.
    const batchId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SEC * 1000)

    // Safety: if an old entry is somehow still there, stop its timer first
    const old = offers.get(rideId)
    if (old) clearTimeout(old.timer)

    const timer = setTimeout(() => {
        onBatchTimeout(io, rideId, batchId).catch((err) => {
            console.error(`Offer timeout error for ride ${rideId}:`, err.message)
        })
    }, OFFER_TIMEOUT_SEC * 1000)
    timer.unref() // a waiting timer must not keep the program alive on shutdown

    offers.set(rideId, {
        batchId,
        pending: new Set(drivers.map((d) => d.driverId.toString())),
        timer,
        expiresAt,
    })

    // 5) Send ride:request to each driver's personal room.
    //    SECURITY: we build the payload field by field. The rider's phone
    //    (and name and id) are NEVER included.
    for (const driver of drivers) {
        io.to(`user:${driver.driverId}`).emit('ride:request', {
            rideId: ride._id,
            pickup: { address: ride.pickupLocation.address, coordinates: ride.pickupLocation.coordinates },
            drop: { address: ride.dropLocation.address, coordinates: ride.dropLocation.coordinates },
            vehicleType: ride.vehicleTypeRequested,
            distanceKm: ride.distanceKm,
            estimatedDurationMin: ride.estimatedDurationMin,
            fareRangeMin: ride.fareRangeMin,
            fareRangeMax: ride.fareRangeMax,
            distanceToPickupKm: driver.distanceKm,   // how far THIS driver is from the pickup
            countdownSec: OFFER_TIMEOUT_SEC,
            expiresAt: expiresAt.toISOString(),      // the server's clock: the app counts down to this
        })
    }

    return drivers
}

// ---------------------------------------------------------------
// NEW. The countdown ran out. Drivers who did not answer lose their turn,
// and the ride goes to the next batch.
// ---------------------------------------------------------------
const onBatchTimeout = async (io, rideId, batchId) => {
    // 1) Is this timer still for the CURRENT batch? If the batch was already
    //    finished (everyone declined, or someone accepted), do nothing.
    const entry = offers.get(rideId)
    if (!entry || entry.batchId !== batchId) return

    // 2) Take the silent drivers and remove the entry BEFORE any await,
    //    so nothing else can use it while we talk to the database.
    const silentDrivers = [...entry.pending]
    offers.delete(rideId)

    // 3) Silent drivers had their turn: remember them, and tell their apps
    //    to remove the request card
    if (silentDrivers.length > 0) {
        await Ride.updateOne(
            { _id: rideId },
            { $addToSet: { declinedBy: { $each: silentDrivers } } }
        )
        for (const driverId of silentDrivers) {
            io.to(`user:${driverId}`).emit('ride:request:closed', { rideId, reason: 'expired' })
        }
    }

    // 4) Next batch (this cancels the ride if no drivers are left)
    await sendNextBatch(io, rideId)
}

// ---------------------------------------------------------------
// NEW. First call after a ride is created (rideController.createRide).
// Returns the drivers of the first batch.
// ---------------------------------------------------------------
const startDispatch = async (io, ride) => {
    return sendNextBatch(io, ride._id.toString())
}

// ---------------------------------------------------------------
// NEW. A driver declines (rideSocket 'ride:decline' calls this).
// Allowed ONLY for a driver who is currently being offered this ride.
// Input : rideId and driverId as text
// Output: { ok: true } or { ok: false, error: '...' }
// ---------------------------------------------------------------
const declineOffer = async (io, rideId, driverId) => {
    // 1) Was this driver really offered this ride, and not answered yet?
    const entry = offers.get(rideId)
    if (!entry || !entry.pending.has(driverId)) {
        return { ok: false, error: 'This request is no longer available' }
    }

    // 2) Remove the driver from "pending" BEFORE any await
    entry.pending.delete(driverId)
    const everyoneAnswered = entry.pending.size === 0
    if (everyoneAnswered) {
        // The whole batch said no: stop the countdown now, do not wait for it
        clearTimeout(entry.timer)
        offers.delete(rideId)
    }

    // 3) This driver had their turn: never offer this ride to them again
    await Ride.updateOne({ _id: rideId }, { $addToSet: { declinedBy: driverId } })

    // 4) If that was the last pending driver, go on to the next batch
    if (everyoneAnswered) {
        await sendNextBatch(io, rideId)
    }

    return { ok: true }
}

// ---------------------------------------------------------------
// NEW. Stop offering a ride (someone accepted it, or the rider cancelled).
// Stops the countdown and tells the other drivers to remove the request card.
// reason         : 'taken' or 'cancelled'
// exceptDriverId : the driver who won (text), so we do not tell them it is gone
// ---------------------------------------------------------------
const closeOffers = (io, rideId, reason, exceptDriverId = null) => {
    const entry = offers.get(rideId)
    if (!entry) return

    clearTimeout(entry.timer)
    offers.delete(rideId)

    for (const driverId of entry.pending) {
        if (driverId === exceptDriverId) continue
        io.to(`user:${driverId}`).emit('ride:request:closed', { rideId, reason })
    }
}

module.exports = { findNearbyDrivers, startDispatch, declineOffer, closeOffers }