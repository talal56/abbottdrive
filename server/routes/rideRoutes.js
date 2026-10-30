// routes/rideRoutes.js
// Connects ride URLs to the functions in rideController.
// Routes only WIRE things together. The real work happens in the controller.
// app.js mounts this file at /api/rides, so "/" below means "/api/rides".

const express = require('express')
const router = express.Router()
const rideController = require('../controllers/rideController')
const authMiddleware = require('../middleware/authMiddleware')
const roleMiddleware = require('../middleware/roleMiddleware')

// Middleware order is always: 1) auth (who are you?)  2) role (are you allowed?)  3) controller.

// RIDER: request a new ride
// POST /api/rides
router.post('/', authMiddleware, roleMiddleware(['rider']), rideController.createRide)

// RIDER, DRIVER of this ride, or ADMIN: view one ride
// GET /api/rides/:id
// No role check here. The controller checks that you belong to this ride.
router.get('/:id', authMiddleware, rideController.getRideById)

// DRIVER: accept a requested ride
// PATCH /api/rides/:id/accept
router.patch('/:id/accept', authMiddleware, roleMiddleware(['driver']), rideController.acceptRide)

// DRIVER: move the ride forward (arriving, in-progress, completed)
// PATCH /api/rides/:id/status      Body: { "status": "arriving" }
router.patch('/:id/status', authMiddleware, roleMiddleware(['driver']), rideController.updateRideStatus)

// RIDER or DRIVER of this ride: cancel before the trip starts
// PATCH /api/rides/:id/cancel
// No role check here. The controller decides if you are the rider or the driver.
router.patch('/:id/cancel', authMiddleware, rideController.cancelRide)

module.exports = router