// controllers/authController.js
const crypto = require('crypto')                 // NEW: random tokens and SHA-256 hashes
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const env = require('../config/env')             // NEW: checked settings (secret, lifetimes)
const User = require('../models/User')
const RefreshToken = require('../models/RefreshToken') // NEW

const DAY_MS = 24 * 60 * 60 * 1000               // NEW: one day in milliseconds

// NEW: a real refresh token is 48 random bytes written as 96 hex characters.
// We use this to reject nonsense before we touch the database.
const REFRESH_TOKEN_PATTERN = /^[a-f0-9]{96}$/

// FIXED: the access token is now short-lived (15 minutes by default, set by
// JWT_EXPIRES_IN in env.js). The app gets a new one by calling refresh.
// The token stores the user's id and roles.
const createToken = (user) => {
    return jwt.sign(
        { id: user._id, roles: user.roles },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN }
    )
}

// Helper: the user info we are allowed to send back (never the password)
const publicUser = (user) => ({
    id: user._id,
    name: user.name,
    phone: user.phone,
    roles: user.roles,
})

// ---------------------------------------------------------------
// NEW. Helper: turn a refresh token into its SHA-256 hash.
// The database stores only the hash. A fast hash is safe here because the
// token is 48 random bytes that nobody can guess (unlike a password).
// ---------------------------------------------------------------
const hashToken = (token) => {
    return crypto.createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------
// NEW. Helper: make a refresh token, save its hash, return the REAL token.
// family: the id of this login. A new login passes a new family id,
//         a refresh passes the same family id as the token it replaces.
// This is the only moment the real token exists on the server.
// ---------------------------------------------------------------
const issueRefreshToken = async (userId, family) => {
    const token = crypto.randomBytes(48).toString('hex')

    await RefreshToken.create({
        user: userId,
        tokenHash: hashToken(token),
        family,
        expiresAt: new Date(Date.now() + env.REFRESH_EXPIRES_DAYS * DAY_MS),
    })

    return token
}

// ---------------------------------------------------------------
// NEW. Helper: revoke every active token of a family.
// Used for logout and when a reused (stolen) token is detected.
// ---------------------------------------------------------------
const revokeFamily = async (family) => {
    await RefreshToken.updateMany(
        { family, revokedAt: null },       // only the ones still active
        { $set: { revokedAt: new Date() } }
    )
}

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

        // NEW: a new signup is a new login, so it starts a new family
        const refreshToken = await issueRefreshToken(newUser._id, crypto.randomUUID())

        // FIXED: the response now also contains the refresh token
        res.status(201).json({ token: createToken(newUser), refreshToken, user: publicUser(newUser) })
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

        // NEW: every login starts its own family, so logging out on one
        // phone does not log out the same account on another phone
        const refreshToken = await issueRefreshToken(user._id, crypto.randomUUID())

        // FIXED: the response now also contains the refresh token
        res.status(200).json({ token: createToken(user), refreshToken, user: publicUser(user) })
    } catch (err) {
        console.error('Login error:', err)
        res.status(500).json({ error: 'Login failed' })
    }
}

// ---------------------------------------------------------------
// NEW. Swap a refresh token for a new access token AND a new refresh token.
// POST /api/auth/refresh
// Body: { "refreshToken": "<the long token from login>" }
//
// The old refresh token is used up (rotation). If a used-up token ever
// comes back, someone copied it, so we revoke the whole family.
// Roles are read fresh from MongoDB, so a role change (for example after
// the admin approves a vehicle) appears in the new access token.
// ---------------------------------------------------------------
const refresh = async (req, res) => {
    try {
        // 1) The token must be text in the right shape.
        //    One short message for every failure (see the table above).
        const { refreshToken } = req.body || {}
        if (typeof refreshToken !== 'string' || !REFRESH_TOKEN_PATTERN.test(refreshToken)) {
            return res.status(401).json({ error: 'Invalid refresh token' })
        }

        // 2) Find the record by the hash of the token
        const record = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) })
        if (!record) {
            return res.status(401).json({ error: 'Invalid refresh token' })
        }

        // 3) THEFT CHECK: this token was already used or revoked.
        //    A honest app only ever holds the newest token, so someone is
        //    replaying an old one. Revoke the whole family.
        if (record.revokedAt) {
            await revokeFamily(record.family)
            console.warn(`Refresh token reuse detected for user ${record.user}. Family ${record.family} revoked.`)
            return res.status(401).json({ error: 'Invalid refresh token' })
        }

        // 4) Expired (the TTL index may not have deleted it yet)
        if (record.expiresAt.getTime() <= Date.now()) {
            return res.status(401).json({ error: 'Invalid refresh token' })
        }

        // 5) Retire this token. One atomic update: it works only if the token
        //    is STILL active. If two requests arrive together with the same
        //    token, only the first one wins (same idea as acceptRide).
        const retired = await RefreshToken.findOneAndUpdate(
            { _id: record._id, revokedAt: null },
            { $set: { revokedAt: new Date() } },
            { returnDocument: 'after' }
        )
        if (!retired) {
            // The loser of the race looks exactly like a reused token
            await revokeFamily(record.family)
            console.warn(`Refresh token used twice at once for user ${record.user}. Family ${record.family} revoked.`)
            return res.status(401).json({ error: 'Invalid refresh token' })
        }

        // 6) Load the user again. This is how new roles reach the app.
        const user = await User.findById(record.user)
        if (!user) {
            // The account was deleted: end this session
            await revokeFamily(record.family)
            return res.status(401).json({ error: 'Invalid refresh token' })
        }

        // 7) Issue the next token in the SAME family and a new access token
        const newRefreshToken = await issueRefreshToken(user._id, record.family)

        res.status(200).json({
            token: createToken(user),
            refreshToken: newRefreshToken,
            user: publicUser(user),
        })
    } catch (err) {
        console.error('Refresh error:', err)
        res.status(500).json({ error: 'Token refresh failed' })
    }
}

// ---------------------------------------------------------------
// NEW. Log out: cancel the refresh token (and its whole family).
// POST /api/auth/logout
// Body: { "refreshToken": "<the long token>" }
//
// No access token is needed, so it also works after the access token
// has expired. It answers 200 even for an unknown token, so nobody can
// use this route to find out which tokens exist.
// NOTE: the short access token cannot be cancelled and works until it
// expires (15 minutes by default). The app should delete both tokens.
// ---------------------------------------------------------------
const logout = async (req, res) => {
    try {
        const { refreshToken } = req.body || {}

        if (typeof refreshToken === 'string' && REFRESH_TOKEN_PATTERN.test(refreshToken)) {
            const record = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) })
            if (record) {
                // Revoke every token of this login (this device only)
                await revokeFamily(record.family)
            }
        }

        res.status(200).json({ message: 'Logged out' })
    } catch (err) {
        console.error('Logout error:', err)
        res.status(500).json({ error: 'Logout failed' })
    }
}

module.exports = { signup, login, refresh, logout } // FIXED: refresh and logout added