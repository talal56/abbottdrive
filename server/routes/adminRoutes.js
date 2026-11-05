// routes/adminRoutes.js
// Connects admin URLs to the functions in adminController.
// app.js will mount this file at /api/admin, so "/vehicles" below means "/api/admin/vehicles".

const express = require('express')
const router = express.Router()
const adminController = require('../controllers/adminController')
const authMiddleware = require('../middleware/authMiddleware')
const roleMiddleware = require('../middleware/roleMiddleware')

// SECURITY: these two lines protect EVERY route in this file.
// router.use() runs them before any route below, so a route added later
// can never be left open by mistake.
//   1) auth (who are you?)  2) role (are you an admin?)
// A rider or driver token gets 403 here, even if they know the URL.
router.use(authMiddleware)
router.use(roleMiddleware(['admin']))

// ADMIN: the review queue
// GET /api/admin/vehicles?status=pending      (also: approved, rejected)
router.get('/vehicles', adminController.listVehicles)

// ADMIN: open one vehicle, with fresh 10-minute links to its documents
// GET /api/admin/vehicles/:id
router.get('/vehicles/:id', adminController.getVehicleById)

// ADMIN: approve the vehicle (this also verifies the driver)
// PATCH /api/admin/vehicles/:id/approve      Body (optional): { "deadlineDays": 60 }
router.patch('/vehicles/:id/approve', adminController.approveVehicle)

// ADMIN: reject the vehicle with a reason the driver can read
// PATCH /api/admin/vehicles/:id/reject       Body: { "reason": "CNIC photo is blurry" }
router.patch('/vehicles/:id/reject', adminController.rejectVehicle)

module.exports = router