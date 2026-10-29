// models/User.js
const mongoose = require('mongoose')

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    // FIX: enum is now applied to EACH role inside the array
    roles: {
        type: [{ type: String, enum: ['rider', 'driver', 'admin'] }],
        default: ['rider'],
    },
    activeMode: { type: String, enum: ['rider', 'driver'], default: 'rider' },
    isDriverVerified: { type: Boolean, default: false },
}, { timestamps: true })

module.exports = mongoose.model('User', userSchema)