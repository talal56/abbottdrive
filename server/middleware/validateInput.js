const { body, validationResult } = require('express-validator')

const validate = (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() })
    }
    next()
}

const signupValidation = [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('phone').matches(/^03\d{9}$/).withMessage('Enter a valid Pakistani phone number'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    validate
]

const loginValidation = [
    body('phone').matches(/^03\d{9}$/).withMessage('Enter a valid phone number'),
    body('password').notEmpty().withMessage('Password is required'),
    validate
]

module.exports = { signupValidation, loginValidation }