// app.js
// FIXED: env.js loads .env, checks every value and stops the server with a
// clear message if something is wrong. It must be the FIRST thing we load.
const env = require('./config/env')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')    // NEW: safety headers
const morgan = require('morgan')    // NEW: one log line per request
const connectDB = require('./config/db')
const corsConfig = require('./config/corsConfig')                       // NEW
const { notFound, errorHandler } = require('./middleware/errorHandler') // NEW
const { generalApiLimiter } = require('./middleware/rateLimiter')
const authRoutes = require('./routes/authRoutes')
const rideRoutes = require('./routes/rideRoutes')
const driverRoutes = require('./routes/driverRoutes')
const vehicleRoutes = require('./routes/vehicleRoutes')
const adminRoutes = require('./routes/adminRoutes')

const app = express()

// NEW: behind Render's proxy the real client IP is in a header.
// "1" means: trust exactly one proxy in front of us.
// We turn it on only in production, because on your laptop there is no proxy.
if (env.isProduction) {
    app.set('trust proxy', 1)
}

// NEW: safety headers on every response (also hides "X-Powered-By: Express")
app.use(helmet())

// FIXED: was cors() which allowed every website. Now only the origins
// listed in CLIENT_ORIGINS (mobile apps and Postman are always allowed).
app.use(cors(corsConfig))

// NEW: log every request. "dev" is short and coloured for your terminal,
// "combined" is the standard format for servers. Bodies are never logged.
app.use(morgan(env.isProduction ? 'combined' : 'dev'))

// FIXED: an explicit size limit. Bigger bodies get a 413 from errorHandler.
app.use(express.json({ limit: '100kb' }))

// FIXED: moved above the rate limiter, so a hosting health check
// can never be blocked. Open /api/health in the browser to test it.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

// Limit every /api URL to 100 requests per 15 minutes per IP
app.use('/api', generalApiLimiter)

app.use('/api/auth', authRoutes)         // signup, login
app.use('/api/rides', rideRoutes)        // rider + driver ride actions
app.use('/api/driver', driverRoutes)     // driver online/offline
app.use('/api/vehicles', vehicleRoutes)  // register a vehicle, list my vehicles
app.use('/api/admin', adminRoutes)       // admin reviews and approves vehicles

// NEW: these two MUST stay after all the routes.
// A request that matched no route reaches notFound. An error that
// reaches Express ends up in errorHandler.
app.use(notFound)
app.use(errorHandler)

connectDB()

// FIXED: the port now comes from env.js (a checked number)
app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${env.PORT}`)
})