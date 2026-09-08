const mongoose = require('mongoose')

const rideSchema = new mongoose.Schema({
    rider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    driver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    vehicle: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vehicle',
    },
    pickupLocation: {
        address: { type: String, required: true },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true,
        }
    },
    dropLocation: {
        address: { type: String, required: true },
        coordinates: {
            type: [Number],
            required: true,
        }
    },
    vehicleTypeRequested: {
        type: String,
        enum: ["bike", "rickshaw", "car", "van"],
        required: true,
    },
    distanceKm: {
        type: Number,
    },
    estimatedDurationMin: {
        type: Number,
    },
    fareRangeMin: {
        type: Number,
    },
    fareRangeMax: {
        type: Number,
    },
    finalFare: {
        type: Number,
    },
    status: {
        type: String,
        enum: ["requested", "accepted", "arriving", "in-progress", "completed", "cancelled"],
        default: "requested",
    },
    otp: {
        type: String,
    },
    allowSharing: {
        type: Boolean,
        default: false,
    },
    isPooled: {
        type: Boolean,
        default: false,
    },
    pooledRiders: [{
        rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        pickupLocation: {
            address: String,
            coordinates: [Number]
        },
        dropLocation: {
            address: String,
            coordinates: [Number]
        },
        fareShare: Number,
    }],
    cancelledBy: {
        type: String,
        enum: ["rider", "driver", null],
        default: null,
    },
    cancellationFee: {
        type: Number,
        default: 0,
    }
}, { timestamps: true })

rideSchema.index({ 'pickupLocation.coordinates': '2dsphere' })

module.exports = mongoose.model('Ride', rideSchema)