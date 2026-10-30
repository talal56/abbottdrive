// app.js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const connectDB = require('./config/db')
const { generalApiLimiter } = require('./middleware/rateLimiter')
const authRoutes = require('./routes/authRoutes')
const rideRoutes = require('./routes/rideRoutes')
const driverRoutes = require('./routes/driverRoutes')

const app = express()

app.use(cors())
app.use(express.json())

// Limit every /api URL to 100 requests per 15 minutes per IP
app.use('/api', generalApiLimiter)

// A simple check that the server is alive: open /api/health in the browser
app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

app.use('/api/auth', authRoutes)     // signup, login
app.use('/api/rides', rideRoutes)    // rider + driver ride actions
app.use('/api/driver', driverRoutes) // driver online/offline

connectDB()

const PORT = process.env.PORT || 5000

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`)
})