const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const User = require('../models/User')

const signup = async (req, res) => {
    try {
        const { name, phone, password, roles } = req.body

        const existingUser = await User.findOne({ phone })
        if (existingUser) {
            return res.status(400).json({ error: 'Phone number already registered' })
        }

        const hashedPassword = await bcrypt.hash(password, 10)

        const newUser = await User.create({
            name,
            phone,
            password: hashedPassword,
            roles: roles || ['rider'],
        })

        const token = jwt.sign(
            { id: newUser._id, roles: newUser.roles },
            process.env.JWT_SECRET,
            { expiresIn: '30m' }
        )

        res.status(201).json({
            token,
            user: {
                id: newUser._id,
                name: newUser.name,
                phone: newUser.phone,
                roles: newUser.roles,
            }
        })
    } catch (err) {
        res.status(500).json({ error: 'Signup failed', details: err.message })
    }
}

const login = async (req, res) => {
    try {
        const { phone, password } = req.body

        const user = await User.findOne({ phone })
        if (!user) {
            return res.status(401).json({ error: 'Invalid phone or password' })
        }

        const isMatch = await bcrypt.compare(password, user.password)
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid phone or password' })
        }

        const token = jwt.sign(
            { id: user._id, roles: user.roles },
            process.env.JWT_SECRET,
            { expiresIn: '30m' }
        )

        res.status(200).json({
            token,
            user: {
                id: user._id,
                name: user.name,
                phone: user.phone,
                roles: user.roles,
            }
        })
    } catch (err) {
        res.status(500).json({ error: 'Login failed', details: err.message })
    }
}

module.exports = { signup, login }