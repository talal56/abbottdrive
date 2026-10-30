// routes/driverRoutes.js
// Connects driver URLs to the functions in driverController.
// app.js mounts this file at /api/driver, so "/status" below means "/api/driver/status".

const express = require('express')
const router = express.Router()
const driverController = require('../controllers/driverController')
const authMiddleware = require('../middleware/authMiddleware')
const roleMiddleware = require('../middleware/roleMiddleware')

// Middleware order is always: 1) auth (who are you?)  2) role (are you allowed?)  3) controller.

// DRIVER: go online or offline
// PATCH /api/driver/status
// Body to go online : { "isOnline": true, "coordinates": [73.2215, 34.1688] }
// Body to go offline: { "isOnline": false }
router.patch('/status', authMiddleware, roleMiddleware(['driver']), driverController.setStatus)

module.exports = router