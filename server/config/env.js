// config/env.js
// NEW FILE. Loads the .env file, checks every value, and exports one clean
// settings object. The rest of the app imports THIS file instead of reading
// process.env directly, so a bad or missing value is caught at start-up and
// not in the middle of a request.
//
// If anything is wrong, we print ALL the problems at once and stop the server.
// We never print secret values, only the variable NAME and what is wrong.

// dotenv copies the lines of the .env file into process.env.
// Calling it here as well means env.js also works in scripts (seeds, tests)
// that do not load dotenv themselves. Loading it twice is harmless.
require('dotenv').config()

// We collect problems here and report them together at the end
const errors = []
const warnings = []

// ---------------------------------------------------------------
// Helper: read a text value. Empty or missing values use the fallback.
// ---------------------------------------------------------------
const readString = (name, fallback = '') => {
    const value = process.env[name]
    if (value === undefined || value.trim() === '') return fallback
    return value.trim()
}

// ---------------------------------------------------------------
// Helper: read a whole number inside a range (for example PORT)
// ---------------------------------------------------------------
const readInt = (name, fallback, min, max) => {
    const raw = readString(name)
    if (raw === '') return fallback

    const number = Number(raw)
    if (!Number.isInteger(number) || number < min || number > max) {
        errors.push(`${name} must be a whole number from ${min} to ${max}`)
        return fallback
    }
    return number
}

// ---------------------------------------------------------------
// Helper: read a lifetime like "15m", "1h", "30s" or "7d".
// This is the format the jsonwebtoken package understands.
// ---------------------------------------------------------------
const readDuration = (name, fallback) => {
    const raw = readString(name)
    if (raw === '') return fallback

    if (!/^\d+[smhd]$/.test(raw)) {
        errors.push(`${name} must look like 15m, 1h, 30s or 7d`)
        return fallback
    }
    return raw
}

// ---------------------------------------------------------------
// 1) Environment name
// ---------------------------------------------------------------
const NODE_ENV = readString('NODE_ENV', 'development')
if (!['development', 'test', 'production'].includes(NODE_ENV)) {
    errors.push('NODE_ENV must be development, test or production')
}
const isProduction = NODE_ENV === 'production'

// ---------------------------------------------------------------
// 2) Required values: the server cannot run safely without these
// ---------------------------------------------------------------
const MONGO_URI = readString('MONGO_URI')
if (MONGO_URI === '') {
    errors.push('MONGO_URI is missing')
} else if (!/^mongodb(\+srv)?:\/\//.test(MONGO_URI)) {
    errors.push('MONGO_URI must start with mongodb:// or mongodb+srv://')
}

const JWT_SECRET = readString('JWT_SECRET')
if (JWT_SECRET === '') {
    errors.push('JWT_SECRET is missing')
} else if (JWT_SECRET.length < 32) {
    // A short secret can be guessed, and then anyone could forge login tokens
    errors.push('JWT_SECRET must be at least 32 characters long')
}

// ---------------------------------------------------------------
// 3) Values with safe defaults
// ---------------------------------------------------------------
const PORT = readInt('PORT', 5000, 1, 65535)
const OSRM_URL = readString('OSRM_URL', 'https://router.project-osrm.org')

// Login token lifetimes (used by the refresh flow in step 6)
const JWT_EXPIRES_IN = readDuration('JWT_EXPIRES_IN', '15m')   // access token: short
const REFRESH_EXPIRES_DAYS = readInt('REFRESH_EXPIRES_DAYS', 30, 1, 365) // refresh token: long

// ---------------------------------------------------------------
// 4) Allowed website origins for CORS (used by corsConfig.js in step 2).
// Example: CLIENT_ORIGINS=http://localhost:5173,https://your-admin.vercel.app
// A browser sends the origin WITHOUT a trailing slash, so we insist on that form.
// ---------------------------------------------------------------
const CLIENT_ORIGINS = readString('CLIENT_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')

for (const origin of CLIENT_ORIGINS) {
    let clean = null
    try {
        clean = new URL(origin).origin // "https://a.com/" becomes "https://a.com"
    } catch (err) {
        clean = null
    }
    if (clean !== origin) {
        errors.push(`CLIENT_ORIGINS has a bad entry "${origin}". Use the form https://example.com with no path and no trailing slash`)
    }
}

// ---------------------------------------------------------------
// 5) Cloudinary (driver document uploads). All three or none.
// In production they are required. In development we only warn, so you can
// still work on parts that do not upload files.
// ---------------------------------------------------------------
const CLOUDINARY_CLOUD_NAME = readString('CLOUDINARY_CLOUD_NAME')
const CLOUDINARY_API_KEY = readString('CLOUDINARY_API_KEY')
const CLOUDINARY_API_SECRET = readString('CLOUDINARY_API_SECRET')

const cloudinaryCount = [CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET]
    .filter((value) => value !== '').length

if (cloudinaryCount > 0 && cloudinaryCount < 3) {
    errors.push('Cloudinary settings are incomplete: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET together')
} else if (cloudinaryCount === 0) {
    if (isProduction) {
        errors.push('Cloudinary settings are required in production')
    } else {
        warnings.push('Cloudinary settings are empty: vehicle document uploads will fail')
    }
}

// ---------------------------------------------------------------
// 6) Report. If there is any error, stop the server now.
// ---------------------------------------------------------------
if (errors.length > 0) {
    console.error('Environment problems found. Fix your .env file:')
    for (const message of errors) {
        console.error(`  - ${message}`)
    }
    process.exit(1)
}

for (const message of warnings) {
    console.warn(`Environment warning: ${message}`)
}

// ---------------------------------------------------------------
// 7) Export one frozen object (nobody can change it by accident)
// ---------------------------------------------------------------
module.exports = Object.freeze({
    NODE_ENV,
    isProduction,
    PORT,
    MONGO_URI,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    REFRESH_EXPIRES_DAYS,
    CLIENT_ORIGINS,
    OSRM_URL,
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
})