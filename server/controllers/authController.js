// controllers/authController.js
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const User = require('../models/User')

// Helper: makes a login token that lasts 30 minutes.
// The token stores the user's id and roles.
const createToken = (user) => {
    return jwt.sign(
        { id: user._id, roles: user.roles },
        process.env.JWT_SECRET,
        { expiresIn: '30m' }
    )
}

// Helper: the user info we are allowed to send back (never the password)
const publicUser = (user) => ({
    id: user._id,
    name: user.name,
    phone: user.phone,
    roles: user.roles,
})

const signup = async (req, res) => {
    try {
        // SECURITY FIX: we read only name, phone and password.
        // We do NOT read "roles" from the request, otherwise anyone could
        // send roles: ["admin"] and make themselves an admin.
        const { name, phone, password } = req.body

        const existingUser = await User.findOne({ phone })
        if (existingUser) {
            return res.status(400).json({ error: 'Phone number already registered' })
        }

        // Hash the password so the real one is never stored
        const hashedPassword = await bcrypt.hash(password, 10)

        const newUser = await User.create({
            name,
            phone,
            password: hashedPassword,
            roles: ['rider'], // every new account starts as a rider only
        })

        res.status(201).json({ token: createToken(newUser), user: publicUser(newUser) })
    } catch (err) {
        // Two signups with the same phone at the same moment hit the unique index
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Phone number already registered' })
        }
        console.error('Signup error:', err) // details stay in the server log only
        res.status(500).json({ error: 'Signup failed' })
    }
}

const login = async (req, res) => {
    try {
        const { phone, password } = req.body

        const user = await User.findOne({ phone })
        // Same message for "no user" and "wrong password" so attackers
        // cannot find out which phone numbers are registered
        if (!user) {
            return res.status(401).json({ error: 'Invalid phone or password' })
        }

        const isMatch = await bcrypt.compare(password, user.password)
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid phone or password' })
        }

        res.status(200).json({ token: createToken(user), user: publicUser(user) })
    } catch (err) {
        console.error('Login error:', err)
        res.status(500).json({ error: 'Login failed' })
    }
}

module.exports = { signup, login }