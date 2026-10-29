// models/DriverStatus.js
// Stores whether a driver is online and where they are right now.
const mongoose = require('mongoose')

const driverStatusSchema = new mongoose.Schema({
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    isOnline: { type: Boolean, default: false },
    // GeoJSON point: coordinates are [longitude, latitude]
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] },
    },
    vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
    currentRide: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', default: null },
    lastSeenAt: { type: Date },
})

// This index lets MongoDB find "drivers near this point" quickly
driverStatusSchema.index({ location: '2dsphere' })

module.exports = mongoose.model('DriverStatus', driverStatusSchema)