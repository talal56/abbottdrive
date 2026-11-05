// seeds/seedAdmin.js
// Creates the FIRST admin account. Run it by hand, one time:
//     node seeds/seedAdmin.js
// It reads the admin's details from .env, so no password is ever written
// inside the code or typed into the terminal (the terminal keeps a history).

require('dotenv').config()
const bcrypt = require('bcrypt')
const mongoose = require('mongoose')
const connectDB = require('../config/db')
const User = require('../models/User')

const run = async () => {
    // 1) Read the admin's details from .env
    const name = (process.env.SEED_ADMIN_NAME || '').trim()
    const phone = (process.env.SEED_ADMIN_PHONE || '').trim()
    const password = process.env.SEED_ADMIN_PASSWORD || ''

    // 2) Check them with the same rules as signup (validateInput.js)
    if (name === '') {
        throw new Error('SEED_ADMIN_NAME is missing in .env')
    }
    if (!/^03\d{9}$/.test(phone)) {
        throw new Error('SEED_ADMIN_PHONE must be 11 digits like 03XXXXXXXXX')
    }
    if (password.length < 8) {
        throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters')
    }

    // 3) Connect to MongoDB (connectDB stops the program if it cannot connect)
    await connectDB()

    // 4) Is this phone number already used?
    const existing = await User.findOne({ phone })
    if (existing) {
        if (existing.roles.includes('admin')) {
            console.log('This phone number is already an admin. Nothing to do.')
        } else {
            // We never turn an existing rider or driver into an admin by accident
            console.log('This phone number belongs to a normal account. Use a different phone number for the admin.')
        }
        return
    }

    // 5) Hash the password (the real one is never stored), same as signup
    const hashedPassword = await bcrypt.hash(password, 10)

    // 6) Create the admin. The roles are set HERE, by us, never by a request.
    await User.create({
        name,
        phone,
        password: hashedPassword,
        roles: ['admin'],
    })

    console.log(`Admin created: ${name} (${phone})`)
    console.log('Next: remove SEED_ADMIN_PASSWORD from .env, then log in with POST /api/auth/login')
}

// Run it, then always close the database connection and stop
run()
    .catch((err) => {
        console.error('seedAdmin failed:', err.message)
        process.exitCode = 1
    })
    .finally(async () => {
        await mongoose.disconnect()
    })