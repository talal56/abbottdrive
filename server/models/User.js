const mongoose = require('mongoose')

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    phone: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
    },
    roles: {
        type: [String],
        enum: ["rider", "driver", "admin"],
        default: ["rider"],
        required: true,
    },
    activeMode: {
        type: String,
        enum: ["rider", "driver"],
        default: "rider",
    },
    isDriverVerified: {
        type: Boolean,
        default: false,
    }
}, { timestamps: true })

module.exports = mongoose.model('User', userSchema)