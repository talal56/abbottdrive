// routes/driverRoutes.js
// Connects driver URLs to the functions in driverController.
// app.js mounts this file at /api/driver, so "/status" below means "/api/driver/status".

const express = require('express')
const router = express.Router()
const driverController = require('../controllers/driverController')
const authMiddleware = require('../middleware/authMiddleware')
const roleMiddleware = require('../middleware/roleMiddleware')
const { locationValidation } = require('../middleware/validateInput')
const { locationIpLimiter, locationLimiter } = require('../middleware/rateLimiter') // NEW

// Middleware order is always: 1) auth (who are you?)  2) role (are you allowed?)  3) controller.

// DRIVER: go online or offline
// PATCH /api/driver/status
// Body to go online : { "isOnline": true, "coordinates": [73.2215, 34.1688] }
// Body to go offline:{ "isOnline": false }
router.patch('/status', authMiddleware, roleMiddleware(['driver']), driverController.setStatus)

// DRIVER: send the current location over HTTP (backup for the socket event
// driver:location, used by the background task when the screen is off)
// POST /api/driver/location
// Body: { "coordinates": [73.2215, 34.1688] }      ([longitude, latitude])
// FIXED: order is now: IP flood guard, auth, role, per-driver limit, validation, controller.
//   - locationIpLimiter comes FIRST, so floods of bad tokens are limited too
//   - locationLimiter comes AFTER auth, because it counts by req.user.id
router.post(
    '/location',
    locationIpLimiter,
    authMiddleware,
    roleMiddleware(['driver']),
    locationLimiter,
    locationValidation,
    driverController.updateLocation
)

module.exports = router