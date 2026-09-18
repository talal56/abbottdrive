//Ride Controllers.
const Ride = require('../models/Ride')
const osrmService = require('../services/osrmService')
const fareService = require('../services/fareService')
const matchingService = require('../services/matchingService')

const createRide = async (req, res) => {
    try {
        const { pickupLocation, dropLocation, vehicleTypeRequested, allowSharing } = req.body
        const riderId = req.user.id

        const routeInfo = await osrmService.getRoute(
            pickupLocation.coordinates,
            dropLocation.coordinates
        )

        const fareEstimate = await fareService.calculateFare({
            distanceKm: routeInfo.distanceKm,
            durationMin: routeInfo.durationMin,
            vehicleType: vehicleTypeRequested,
        })

        const newRide = await Ride.create({
            rider: riderId,
            pickupLocation,
            dropLocation,
            vehicleTypeRequested,
            distanceKm: routeInfo.distanceKm,
            estimatedDurationMin: routeInfo.durationMin,
            fareRangeMin: fareEstimate.min,
            fareRangeMax: fareEstimate.max,
            allowSharing: allowSharing || false,
            status: 'requested',
        })

        const nearbyDrivers = await matchingService.findNearbyDrivers(
            pickupLocation.coordinates,
            vehicleTypeRequested
        )

        res.status(201).json({
            ride: newRide,
            fareEstimate,
            nearbyDrivers,
        })
    } catch (err) {
        res.status(500).json({ error: 'Failed to create ride', details: err.message })
    }
}

const getRideById = async (req, res) => {
    try {
        const ride = await Ride.findById(req.params.id)
            .populate('rider', 'name phone')
            .populate('driver', 'name phone')
            .populate('vehicle')

        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' })
        }

        const userId = req.user.id
        const isParticipant = ride.rider._id.toString() === userId ||
            (ride.driver && ride.driver._id.toString() === userId)

        if (!isParticipant) {
            return res.status(403).json({ error: 'Not authorized to view this ride' })
        }

        res.status(200).json({ ride })
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch ride', details: err.message })
    }
}

const updateRideStatus = async (req, res) => {
    try {
        const { status } = req.body
        const ride = await Ride.findById(req.params.id)

        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' })
        }

        const userId = req.user.id
        const isParticipant = ride.rider.toString() === userId ||
            (ride.driver && ride.driver.toString() === userId)

        if (!isParticipant) {
            return res.status(403).json({ error: 'Not authorized to update this ride' })
        }

        ride.status = status

        if (status === 'accepted') {
            ride.driver = userId
            ride.otp = Math.floor(1000 + Math.random() * 9000).toString()
        }

        if (status === 'completed') {
            ride.finalFare = ride.fareRangeMin
        }

        await ride.save()

        res.status(200).json({ ride })
    } catch (err) {
        res.status(500).json({ error: 'Failed to update ride', details: err.message })
    }
}

const cancelRide = async (req, res) => {
    try {
        const ride = await Ride.findById(req.params.id)

        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' })
        }

        const userId = req.user.id
        const isRider = ride.rider.toString() === userId
        const isDriver = ride.driver && ride.driver.toString() === userId

        if (!isRider && !isDriver) {
            return res.status(403).json({ error: 'Not authorized to cancel this ride' })
        }

        const gracePeriodMs = 2 * 60 * 1000
        const timeSinceCreated = Date.now() - ride.createdAt.getTime()

        let fee = 0
        if (ride.status === 'accepted' && timeSinceCreated > gracePeriodMs) {
            fee = 50
        }

        ride.status = 'cancelled'
        ride.cancelledBy = isRider ? 'rider' : 'driver'
        ride.cancellationFee = fee

        await ride.save()

        res.status(200).json({ ride })
    } catch (err) {
        res.status(500).json({ error: 'Failed to cancel ride', details: err.message })
    }
}

module.exports = { createRide, getRideById, updateRideStatus, cancelRide }