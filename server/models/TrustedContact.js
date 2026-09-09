const mongoose = require('mongoose')

const trustedContactSchema = new mongoose.Schema({
    rider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    phone: {
        type: String,
        required: true,
    },
    autoNotify: {
        type: Boolean,
        default: false,
    }
}, { timestamps: true })

module.exports = mongoose.model('TrustedContact', trustedContactSchema)