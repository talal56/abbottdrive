// app.js
// FIXED: env.js loads .env, checks every value and stops the server with a
// clear message if something is wrong. It must be the FIRST thing we load.
const env = require('./config/env')
const http = require('http')            // NEW: Node's built-in HTTP server (Socket.io needs it)
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')    // safety headers
const morgan = require('morgan')    // one log line per request
const connectDB = require('./config/db')
const corsConfig = require('./config/corsConfig')
const { notFound, errorHandler } = require('./middleware/errorHandler')
const { generalApiLimiter } = require('./middleware/rateLimiter')
const initSockets = require('./sockets')   // NEW: builds the Socket.io server (sockets/index.js)
const authRoutes = require('./routes/authRoutes')
const rideRoutes = require('./routes/rideRoutes')
const driverRoutes = require('./routes/driverRoutes')
const vehicleRoutes = require('./routes/vehicleRoutes')
const adminRoutes = require('./routes/adminRoutes')

const app = express()

// Behind Render's proxy the real client IP is in a header.
// "1" means: trust exactly one proxy in front of us.
// We turn it on only in production, because on your laptop there is no proxy.
if (env.isProduction) {
    app.set('trust proxy', 1)
}

// Safety headers on every response (also hides "X-Powered-By: Express")
app.use(helmet())

// Only the origins listed in CLIENT_ORIGINS may call the API from a browser
// (mobile apps and Postman are always allowed).
app.use(cors(corsConfig))

// Log every request. "dev" is short and coloured for your terminal,
// "combined" is the standard format for servers. Bodies are never logged.
app.use(morgan(env.isProduction ? 'combined' : 'dev'))

// An explicit size limit. Bigger bodies get a 413 from errorHandler.
app.use(express.json({ limit: '100kb' }))

// Above the rate limiter, so a hosting health check can never be blocked.
// Open /api/health in the browser to test it.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

// Limit every /api URL to 100 requests per 15 minutes per IP
app.use('/api', generalApiLimiter)

app.use('/api/auth', authRoutes)         // signup, login, refresh, logout
app.use('/api/rides', rideRoutes)        // rider + driver ride actions
app.use('/api/driver', driverRoutes)     // driver online/offline
app.use('/api/vehicles', vehicleRoutes)  // register a vehicle, list my vehicles
app.use('/api/admin', adminRoutes)       // admin reviews and approves vehicles

// These two MUST stay after all the routes.
// A request that matched no route reaches notFound. An error that
// reaches Express ends up in errorHandler.
app.use(notFound)
app.use(errorHandler)

// NEW: Socket.io cannot attach to "app" directly. It needs a real HTTP server.
// http.createServer(app) wraps Express in one. Express still handles every
// normal request, and Socket.io listens on the SAME port for the live connections.
const server = http.createServer(app)

// NEW: build the Socket.io server (token guard, personal rooms, socket files).
const io = initSockets(server)

// NEW: save the Socket.io server inside Express. Controllers read it with
// req.app.get('io') (rideController does this). It is saved BEFORE the
// server starts listening, so no request can arrive without it.
app.set('io', io)

connectDB()

// FIXED: was app.listen(...). It must be server.listen(...), because the
// HTTP server (not Express alone) is the one Socket.io is attached to.
// The port still comes from env.js (a checked number).
server.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${env.PORT}`)
})