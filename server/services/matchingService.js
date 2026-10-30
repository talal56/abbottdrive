// services/matchingService.js
// Finds drivers who could take a ride request.
// It searches the DriverStatus collection (NOT Ride), because that is
// where each driver's live location is stored.

const DriverStatus = require('../models/DriverStatus')

const MAX_DISTANCE_KM = 5   // only drivers within 5 km of the pickup point
const SEARCH_LIMIT = 50     // how many nearby candidates we load before filtering
const RESULT_LIMIT = 10     // how many drivers we return at most

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
// Main function: called by rideController.createRide
// Input : pickupCoords = [longitude, latitude], vehicleType = 'bike' | 'rickshaw' | 'car' | 'van'
// Output: an array of nearby drivers, nearest first
// ---------------------------------------------------------------
const findNearbyDrivers = async (pickupCoords, vehicleType) => {
    // 1) Check the pickup point is [number, number]
    if (!Array.isArray(pickupCoords) || pickupCoords.length !== 2 ||
        typeof pickupCoords[0] !== 'number' || typeof pickupCoords[1] !== 'number') {
        throw new Error('pickupCoords must be [longitude, latitude]')
    }

    // 2) Ask MongoDB for drivers who are:
    //    - online
    //    - not on another ride (currentRide is empty)
    //    - within 5 km of the pickup point
    //    $near also sorts the results, nearest first.
    //    $maxDistance is in METRES, so we multiply km by 1000.
    const candidates = await DriverStatus.find({
        isOnline: true,
        currentRide: null,
        location: {
            $near: {
                $geometry: { type: 'Point', coordinates: pickupCoords },
                $maxDistance: MAX_DISTANCE_KM * 1000,
            },
        },
    })
        .limit(SEARCH_LIMIT)
        .populate('driver', 'name isDriverVerified') // never load the password or phone
        .populate('vehicle')

    // 3) Keep only the candidates that pass the checks MongoDB could not do:
    //    - the driver was verified by an admin
    //    - the vehicle was verified by an admin
    //    - the vehicle is the type the rider asked for
    //    We use a normal loop (not .filter) so each step is easy to read.
    const matches = []

    for (const status of candidates) {
        // Skip if the user record or vehicle record is missing (deleted data)
        if (!status.driver || !status.vehicle) continue

        if (!status.driver.isDriverVerified) continue
        if (!status.vehicle.verified) continue
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

        // Stop once we have enough drivers
        if (matches.length === RESULT_LIMIT) break
    }

    // The list is already nearest first, because MongoDB sorted it for us
    return matches
}

module.exports = { findNearbyDrivers }