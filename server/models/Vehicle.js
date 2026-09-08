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
        enum: ["petrol", "cng", "hybrid", "ev"],
        required: true,
    },
    vehicleType: {
        type: String,
        enum: ["bike", "rickshaw", "car", "van"],
        required: true,
    },
    registrationNumber: {
        type: String,
        required: true,
    },
    verified: {
        type: Boolean,
        default: false,
    }
}, { timestamps: true })

module.exports = mongoose.model('Vehicle', vehicleSchema)