// models/RefreshToken.js
// NEW FILE. One record per refresh token.
// We store only the SHA-256 HASH of the token, never the token itself.
// If the database ever leaks, the hashes cannot be used to log in.
//
// The real token is a random string made in authController.js (step 6b).
// It is sent to the app once and never stored on the server.

const mongoose = require('mongoose')

const refreshTokenSchema = new mongoose.Schema({
    // Whose login session this is
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },

    // SHA-256 hash of the real token (64 hex characters).
    // "unique" also creates an index, so finding a token by its hash is fast.
    tokenHash: {
        type: String,
        required: true,
        unique: true,
    },

    // One id per login. Every token made by refreshing that login keeps the
    // same family id. If an old (already used) token comes back, we revoke
    // the WHOLE family, because someone copied it.
    family: {
        type: String,
        required: true,
    },

    // When this token stops working
    expiresAt: {
        type: Date,
        required: true,
    },

    // Empty = still active.
    // Filled = retired: it was used once, the user logged out, or theft was detected.
    // We keep the record (instead of deleting it) so a reused token can be recognised.
    revokedAt: {
        type: Date,
    },
}, { timestamps: true })

// TTL index: MongoDB deletes each record by itself once "expiresAt" has passed.
// expireAfterSeconds: 0 means "delete exactly at the date in the field".
// (MongoDB checks about once a minute, so deletion is not instant.)
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Revoking a whole family and logging out look up records by family
refreshTokenSchema.index({ family: 1 })

module.exports = mongoose.model('RefreshToken', refreshTokenSchema)