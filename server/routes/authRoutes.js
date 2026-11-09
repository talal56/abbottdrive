// routes/authRoutes.js
const express = require('express')
const router = express.Router()
const authController = require('../controllers/authController')
const { signupValidation, loginValidation } = require('../middleware/validateInput')
const { loginLimiter } = require('../middleware/rateLimiter')

router.post('/signup', signupValidation, authController.signup)
router.post('/login', loginLimiter, loginValidation, authController.login)

// NEW: swap a refresh token for a new access token + a new refresh token.
// POST /api/auth/refresh      Body: { "refreshToken": "..." }
// No authMiddleware: the access token is usually expired at this point.
// The refresh token in the body is the proof of identity.
router.post('/refresh', authController.refresh)

// NEW: log out by cancelling the refresh token.
// POST /api/auth/logout       Body: { "refreshToken": "..." }
// No authMiddleware, so it also works after the access token expired.
router.post('/logout', authController.logout)

module.exports = router