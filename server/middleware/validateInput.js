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

// NEW: rules for POST /api/driver/location
// Body must be: { "coordinates": [longitude, latitude] }
// Example:      { "coordinates": [73.2215, 34.1688] }
// "custom" lets us write the rule ourselves. We insist on real NUMBERS
// (not text like "73.2") in the right range.
const locationValidation = [
    body('coordinates').custom((coords) => {
        if (!Array.isArray(coords) || coords.length !== 2) {
            throw new Error('coordinates must be [longitude, latitude]')
        }
        const [lng, lat] = coords
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            throw new Error('coordinates must be two numbers')
        }
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
            throw new Error('coordinates are out of range')
        }
        return true // true means "this value is fine"
    }),
    validate
]

module.exports = { signupValidation, loginValidation, locationValidation } // NEW: locationValidation added