const mongoose = require('mongoose')

const complaintSchema = new mongoose.Schema({
    filedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    against: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    ride: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ride',
    },
    category: {
        type: String,
        enum: ["fare-dispute", "safety", "no-show", "misconduct", "other"],
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    urgency: {
        type: String,
        enum: ["low", "medium", "high"],
        default: "medium",
    },
    status: {
        type: String,
        enum: ["open", "in-review", "resolved", "rejected"],
        default: "open",
    },
    resolutionNote: {
        type: String,
    },
    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }
}, { timestamps: true })

module.exports = mongoose.model('Complaint', complaintSchema)