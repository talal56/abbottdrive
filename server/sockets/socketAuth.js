// sockets/socketAuth.js
// NEW FILE. The "security guard" for Socket.io.
// Every app that tries to open a socket connection must show its access
// token first. This guard checks the token BEFORE the connection is accepted.
//
// Analogy: the token is a ticket. The guard checks the ticket only at the
// door (the handshake). Once you are inside, nobody checks it again.
//
// sockets/index.js will use it like this:   io.use(socketAuth)
// The app sends the token like this:        io({ auth: { token } })

const jwt = require('jsonwebtoken')
const env = require('../config/env') // checked settings: we read JWT_SECRET from here

// ---------------------------------------------------------------
// Helper: build the error the app receives when the guard says no.
// The app sees it as a "connect_error" event with:
//   err.message   : always the short text 'unauthorized' (no details for attackers)
//   err.data.code : a machine-readable reason, so the app knows what to do
//                   'NO_TOKEN'      -> the app forgot to send a token
//                   'TOKEN_EXPIRED' -> refresh the token, then connect again
//                   'TOKEN_INVALID' -> the token is wrong or changed: log in again
// ---------------------------------------------------------------
const rejection = (code) => {
    const err = new Error('unauthorized')
    err.data = { code }
    return err
}

// ---------------------------------------------------------------
// The guard itself. Socket.io calls it once for every new connection.
// socket : the connection that is trying to join
// next   : next() = let it in, next(error) = refuse it
// ---------------------------------------------------------------
const socketAuth = (socket, next) => {
    // 1) Read the token the app sent in the handshake.
    //    "auth" may be missing, so we use a safe fallback object.
    const auth = socket.handshake.auth || {}
    const token = auth.token

    // 2) The token must be a non-empty text
    if (typeof token !== 'string' || token.trim() === '') {
        return next(rejection('NO_TOKEN'))
    }

    try {
        // 3) Check the signature and the expiry time.
        //    - the secret comes from config/env.js (same one the HTTP login uses)
        //    - algorithms: only HS256 is accepted, because that is what
        //      authController signs with (this blocks "algorithm swap" tricks)
        const decoded = jwt.verify(token.trim(), env.JWT_SECRET, { algorithms: ['HS256'] })

        // 4) The token must hold what authController puts in it:
        //    an id (text) and a roles array. Anything else is not our token.
        if (typeof decoded.id !== 'string' || !Array.isArray(decoded.roles)) {
            return next(rejection('TOKEN_INVALID'))
        }

        // 5) Remember who this connection belongs to.
        //    Every socket file (driverSocket, rideSocket) reads socket.user.
        //    exp = when this token expires (seconds since 1970), kept for later use.
        socket.user = {
            id: decoded.id,
            roles: decoded.roles,
            exp: decoded.exp,
        }

        // 6) All good: let the connection in
        return next()
    } catch (err) {
        // 7) The token failed the check.
        //    We log only the KIND of problem, never the token itself.
        if (err.name === 'TokenExpiredError') {
            console.warn('Socket refused: expired token')
            return next(rejection('TOKEN_EXPIRED'))
        }
        console.warn('Socket refused: invalid token')
        return next(rejection('TOKEN_INVALID'))
    }
}

module.exports = socketAuth