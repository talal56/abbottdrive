// routes/vehicleRoutes.js
// Connects vehicle URLs to the functions in vehicleController.
// Routes only WIRE things together. The real work happens in the controller.
// app.js will mount this file at /api/vehicles, so "/" below means "/api/vehicles".

const express = require('express')
const router = express.Router()
const vehicleController = require('../controllers/vehicleController')
const authMiddleware = require('../middleware/authMiddleware')
const { uploadVehicleDocuments } = require('../middleware/upload')

// Middleware order matters:
//   1) auth   (who are you?)
//   2) upload (read and check the files)
//   3) controller
// Auth must come BEFORE upload, otherwise anyone without a login
// could send files to your server.

// ANY LOGGED-IN USER: register a vehicle with the 3 documents
// POST /api/vehicles
// Body type: form-data (not raw JSON)
//   Text fields: model, engineSize, fuelType, vehicleType, registrationStatus, registrationNumber
//   File fields: cnic, license, registration
// No role check: every new account is a rider, and the driver role
// is only given after the admin approves the vehicle.
router.post('/', authMiddleware, uploadVehicleDocuments, vehicleController.registerVehicle)

// ANY LOGGED-IN USER: list my own vehicles (to see "pending", "approved" or the rejection reason)
// GET /api/vehicles/mine
router.get('/mine', authMiddleware, vehicleController.getMyVehicles)

module.exports = router