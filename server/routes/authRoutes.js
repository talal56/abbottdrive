const express = require('express')
const router = express.Router()
const authController = require('../controllers/authController')
const { signupValidation, loginValidation } = require('../middleware/validateInput')
const { loginLimiter } = require('../middleware/rateLimiter')

router.post('/signup', signupValidation, authController.signup)
router.post('/login', loginLimiter, loginValidation, authController.login)

module.exports = router