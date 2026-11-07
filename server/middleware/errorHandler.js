// middleware/errorHandler.js
// NEW FILE. Two safety nets that app.js will add AFTER all the routes (step 5):
//   1) notFound     : answers URLs that do not exist
//   2) errorHandler : catches errors and sends a SHORT message to the client
//
// The rule: details go to the server log, only a short safe message
// goes to the client. Error details can contain file paths or database
// information that an attacker could use.

// ---------------------------------------------------------------
// 1) notFound: no route matched the URL
// ---------------------------------------------------------------
const notFound = (req, res) => {
    res.status(404).json({ error: 'Route not found' })
}

// ---------------------------------------------------------------
// Helper: decide the status code and the safe message for an error.
// Returns { status, message }.
// We check for KNOWN kinds of errors first. Anything unknown becomes
// a plain 500 with a generic message.
// ---------------------------------------------------------------
const describeError = (err) => {
    // Broken JSON in the request body (a missing quote or comma).
    // express.json() gives these errors a "type" we can recognise.
    if (err.type === 'entity.parse.failed') {
        return { status: 400, message: 'Invalid JSON in request body' }
    }

    // The request body is bigger than the limit set in app.js
    if (err.type === 'entity.too.large') {
        return { status: 413, message: 'Request body too large' }
    }

    // Mongoose could not turn a value into the right type,
    // for example an id that is not a real ObjectId
    if (err.name === 'CastError') {
        return { status: 400, message: 'Invalid id or value' }
    }

    // Mongoose rejected data that breaks the model rules
    if (err.name === 'ValidationError') {
        return { status: 400, message: 'Invalid data' }
    }

    // MongoDB unique index was broken (for example the same phone twice)
    if (err.code === 11000) {
        return { status: 409, message: 'This record already exists' }
    }

    // jsonwebtoken problems: a bad, changed or expired token
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return { status: 401, message: 'Invalid or expired token' }
    }

    // Anything else is unexpected: a plain 500 and NO details
    return { status: 500, message: 'Server error' }
}

// ---------------------------------------------------------------
// 2) errorHandler: the central place where errors end up.
// Express knows this is an error handler only because it has
// FOUR parameters (err, req, res, next). Do not remove "next",
// even though we do not use it.
// ---------------------------------------------------------------
const errorHandler = (err, req, res, next) => {
    // If the response was already partly sent, we cannot send a new one.
    // Let Express close the connection.
    if (res.headersSent) {
        return next(err)
    }

    const { status, message } = describeError(err)

    // Log the details on the server only.
    // We log the method and URL, but NEVER the request body,
    // because it can contain passwords.
    if (status >= 500) {
        console.error(`${req.method} ${req.originalUrl} failed:`, err)
    } else {
        console.warn(`${req.method} ${req.originalUrl} rejected (${status}): ${message}`)
    }

    res.status(status).json({ error: message })
}

module.exports = { notFound, errorHandler }