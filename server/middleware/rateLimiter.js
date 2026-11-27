const rateLimit = require('express-rate-limit')

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
})

const generalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    // NEW: the driver's background location has its own limiters below.
    // This limiter is mounted with app.use('/api', ...), so req.path here is
    // relative to /api. The location URL is /api/driver/location, which means
    // req.path is '/driver/location'. Only that exact POST skips this limiter.
    skip: (req) => req.method === 'POST' && req.path === '/driver/location',
})

// NEW: flood guard for POST /api/driver/location. It runs BEFORE the token
// check, so requests with bad or missing tokens are limited too.
// It counts by IP (the default). The limit is high on purpose, because
// several drivers on mobile data can share one IP address.
// [TO CONFIRM] value
const locationIpLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 300,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
})

// NEW: the real limit for POST /api/driver/location. It counts by DRIVER ID,
// so one driver cannot use up the limit of other drivers on the same IP.
// It must run AFTER authMiddleware, because req.user is set there.
// The app sends one location every 5 seconds = 12 per minute, so 30 per
// minute leaves room for retries after a weak-signal gap.
// [TO CONFIRM] value
const locationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Sending location too fast. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
})

module.exports = { loginLimiter, generalApiLimiter, locationIpLimiter, locationLimiter } // NEW: two limiters added