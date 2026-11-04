// models/Vehicle.js
// A driver's vehicle. A new vehicle starts as "pending" and only an ADMIN
// can approve or reject it. Matching and accepting rides need "approved".

const mongoose = require('mongoose')

const vehicleSchema = new mongoose.Schema({
    driver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    model: {
        type: String,
        required: true,
    },
    engineSize: {
        type: String,
    },
    fuelType: {
        type: String,
        enum: ['petrol', 'cng', 'hybrid', 'ev'],
        required: true,
    },
    vehicleType: {
        type: String,
        enum: ['bike', 'rickshaw', 'car', 'van'],
        required: true,
    },
    registrationNumber: {
        type: String,
        required: true,
    },

    // FIXED: replaces the old "verified: true/false" flag.
    // pending  = driver submitted it, admin has not looked yet
    // approved = admin checked it, the vehicle may be used for rides
    // rejected = admin refused it (see rejectionReason)
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
    },

    // NEW: why the admin rejected it, so the driver can fix the problem
    rejectionReason: {
        type: String,
    },

    // NEW: which admin made the decision, and when (an audit trail)
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    verifiedAt: {
        type: Date,
    },
}, { timestamps: true })

// NEW: the admin's "pending vehicles" list and the matching queries
// search by status, so an index keeps them fast.
vehicleSchema.index({ status: 1 })

module.exports = mongoose.model('Vehicle', vehicleSchema)