// controllers/rideController.js
const crypto = require('crypto')
const mongoose = require('mongoose')
const Ride = require('../models/Ride')
const User = require('../models/User')
const Vehicle = require('../models/Vehicle')
const DriverStatus = require('../models/DriverStatus')
const osrmService = require('../services/osrmService')
const fareService = require('../services/fareService')
const matchingService = require('../services/matchingService')

const VEHICLE_TYPES = ['bike', 'rickshaw', 'car', 'van']
const CANCEL_GRACE_MS = 2 * 60 * 1000 // free cancellation for 2 minutes after accept
const CANCEL_FEE = 50                 // rupees [TO CONFIRM]

// The only allowed order of statuses. A driver can move a ride one step forward.
const NEXT_STATUS = {
    accepted: 'arriving',
    arriving: 'in-progress',
    'in-progress': 'completed',
}

// Checks a location object: { address: "text", coordinates: [lng, lat] }
const isValidPoint = (loc) => {
    if (!loc || typeof loc.address !== 'string' || loc.address.trim() === '') return false
    if (!Array.isArray(loc.coordinates) || loc.coordinates.length !== 2) return false
    const [lng, lat] = loc.coordinates
    return typeof lng === 'number' && typeof lat === 'number' &&
        lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
}

// ---------------------------------------------------------------
// RIDER: request a ride
// ---------------------------------------------------------------
const createRide = async (req, res) => {
    try {
        const { pickupLocation, dropLocation, vehicleTypeRequested, allowSharing } = req.body

        if (!isValidPoint(pickupLocation) || !isValidPoint(dropLocation)) {
            return res.status(400).json({ error: 'Valid pickupLocation and dropLocation are required' })
        }
        if (!VEHICLE_TYPES.includes(vehicleTypeRequested)) {
            return res.status(400).json({ error: 'Invalid vehicle type' })
        }

        // 1) Road distance and time from OSRM
        const routeInfo = await osrmService.getRoute(pickupLocation.coordinates, dropLocation.coordinates)

        // 2) Fare range from our fare rules
        const fareEstimate = await fareService.calculateFare({
            distanceKm: routeInfo.distanceKm,
            durationMin: routeInfo.durationMin,
            vehicleType: vehicleTypeRequested,
        })

        // 3) Save the ride
        const newRide = await Ride.create({
            rider: req.user.id,
            pickupLocation,
            dropLocation,
            vehicleTypeRequested,
            distanceKm: routeInfo.distanceKm,
            estimatedDurationMin: routeInfo.durationMin,
            fareRangeMin: fareEstimate.min,
            fareRangeMax: fareEstimate.max,
            allowSharing: allowSharing === true,
            status: 'requested',
        })

        // 4) Find nearby drivers (later we will notify them in real time)
        const nearbyDrivers = await matchingService.findNearbyDrivers(
            pickupLocation.coordinates,
            vehicleTypeRequested
        )

        res.status(201).json({ ride: newRide, fareEstimate, nearbyDrivers })
    } catch (err) {
        console.error('createRide error:', err)
        res.status(500).json({ error: 'Failed to create ride' })
    }
}

// ---------------------------------------------------------------
// RIDER or DRIVER of this ride (or admin): view a ride
// ---------------------------------------------------------------
const getRideById = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid ride id' })
        }

        const ride = await Ride.findById(req.params.id)
            .populate('rider', 'name phone')
            .populate('driver', 'name phone')
            .populate('vehicle')

        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' })
        }

        const userId = req.user.id
        const isRider = ride.rider._id.toString() === userId
        const isDriver = ride.driver && ride.driver._id.toString() === userId
        const isAdmin = req.user.roles.includes('admin')

        if (!isRider && !isDriver && !isAdmin) {
            return res.status(403).json({ error: 'Not authorized to view this ride' })
        }

        const data = ride.toObject()
        // The OTP is for the RIDER to tell the driver. The driver must never see it,
        // otherwise they could start the ride without meeting the rider.
        if (!isRider) {
            delete data.otp
        }

        res.status(200).json({ ride: data })
    } catch (err) {
        console.error('getRideById error:', err)
        res.status(500).json({ error: 'Failed to fetch ride' })
    }
}

// ---------------------------------------------------------------
// DRIVER: accept a requested ride
// ---------------------------------------------------------------
const acceptRide = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid ride id' })
        }

        const driverId = req.user.id

        // The driver must be verified by an admin, and have a verified vehicle
        const driver = await User.findById(driverId)
        if (!driver || !driver.isDriverVerified) {
            return res.status(403).json({ error: 'Driver is not verified' })
        }
        const vehicle = await Vehicle.findOne({ driver: driverId, verified: true })
        if (!vehicle) {
            return res.status(403).json({ error: 'No verified vehicle found' })
        }

        const ride = await Ride.findById(req.params.id)
        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' })
        }
        if (ride.rider.toString() === driverId) {
            return res.status(400).json({ error: 'You cannot accept your own ride' })
        }
        if (vehicle.vehicleType !== ride.vehicleTypeRequested) {
            return res.status(400).json({ error: 'Your vehicle type does not match this ride' })
        }

        // 4-digit pickup code, made with a secure random generator
        const otp = String(crypto.randomInt(1000, 10000))

        // One atomic update: it only works if the ride is STILL "requested".
        // If two drivers tap accept together, only the first one succeeds.
        const updated = await Ride.findOneAndUpdate(
            { _id: ride._id, status: 'requested' },
            { driver: driverId, vehicle: vehicle._id, status: 'accepted', otp, acceptedAt: new Date() },
            { new: true }
        )
        if (!updated) {
            return res.status(409).json({ error: 'This ride is no longer available' })
        }

        // Mark the driver as busy so they are not matched to other rides
        await DriverStatus.findOneAndUpdate({ driver: driverId }, { currentRide: updated._id })

        const data = updated.toObject()
        delete data.otp // the driver does not get the OTP
        res.status(200).json({ ride: data })
    } catch (err) {
        console.error('acceptRide error:', err)
        res.status(500).json({ error: 'Failed to accept ride' })
    }
}

// ---------------------------------------------------------------
// DRIVER: move the ride forward: arriving -> in-progress -> completed
// ---------------------------------------------------------------
const updateRideStatus = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid ride id' })
        }

        const { status, otp } = req.body
        const ride = await Ride.findById(req.params.id)

        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' })
        }
        // Only the driver assigned to this ride may change its status
        if (!ride.driver || ride.driver.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized to update this ride' })
        }
        // The new status must be exactly the next step
        if (NEXT_STATUS[ride.status] !== status) {
            return res.status(400).json({ error: `Ride is "${ride.status}", cannot change it to "${status}"` })
        }
        // Starting the trip needs the rider's OTP
        if (status === 'in-progress' && otp !== ride.otp) {
            return res.status(400).json({ error: 'Wrong OTP' })
        }

        ride.status = status

        if (status === 'completed') {
            // Placeholder: final fare = low end of the range.
            // Later this will be calculated from the real trip.
            ride.finalFare = ride.fareRangeMin
            // The driver is free again
            await DriverStatus.findOneAndUpdate({ driver: req.user.id }, { currentRide: null })
        }

        await ride.save()

        const data = ride.toObject()
        delete data.otp
        res.status(200).json({ ride: data })
    } catch (err) {
        console.error('updateRideStatus error:', err)
        res.status(500).json({ error: 'Failed to update ride' })
    }
}

// ---------------------------------------------------------------
// RIDER or DRIVER: cancel a ride that has not started yet
// ---------------------------------------------------------------
const cancelRide = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid ride id' })
        }

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

        // A ride that is in progress, finished or already cancelled cannot be cancelled
        if (!['requested', 'accepted', 'arriving'].includes(ride.status)) {
            return res.status(400).json({ error: `A ${ride.status} ride cannot be cancelled` })
        }

        // Fee rule: only the RIDER pays, only after a driver accepted,
        // and only after the 2-minute grace period has passed.
        let fee = 0
        if (isRider && ride.acceptedAt && Date.now() - ride.acceptedAt.getTime() > CANCEL_GRACE_MS) {
            fee = CANCEL_FEE
        }

        // Free the driver if one was assigned
        if (ride.driver) {
            await DriverStatus.findOneAndUpdate({ driver: ride.driver }, { currentRide: null })
        }

        ride.status = 'cancelled'
        ride.cancelledBy = isRider ? 'rider' : 'driver'
        ride.cancellationFee = fee
        await ride.save()

        const data = ride.toObject()
        if (!isRider) delete data.otp
        res.status(200).json({ ride: data })
    } catch (err) {
        console.error('cancelRide error:', err)
        res.status(500).json({ error: 'Failed to cancel ride' })
    }
}

module.exports = { createRide, getRideById, acceptRide, updateRideStatus, cancelRide }