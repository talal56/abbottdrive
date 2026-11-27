// sockets/index.js
// NEW FILE. Builds the Socket.io server (the "radio tower").
// app.js (step 7) calls it like this:   const io = initSockets(server)
//
// What it does:
//   1) creates the Socket.io server on the SAME http server as Express
//   2) uses the same website rules as the REST API (corsConfig.js)
//   3) puts the token guard (socketAuth.js) in front of every connection
//   4) puts each connected person in their personal room  user:<id>
//   5) plugs in the other socket files (driverSocket, rideSocket)

const { Server } = require('socket.io')
const corsConfig = require('../config/corsConfig') // same allowed origins as the REST API
const socketAuth = require('./socketAuth')         // the token guard from step 2

// ---------------------------------------------------------------
// The function app.js will call.
// server : the http server (created in app.js with http.createServer)
// returns: the Socket.io server, so app.js can save it with app.set('io', io)
// ---------------------------------------------------------------
const initSockets = (server) => {
    // 1) Create the Socket.io server on top of the http server.
    //    - cors: reuse corsConfig, so only the origins in CLIENT_ORIGINS can
    //      connect from a browser. Mobile apps and Postman send no Origin
    //      header, so corsConfig already lets them in.
    //    - maxHttpBufferSize: the biggest message we accept (10 KB). Our
    //      messages are tiny (a location, a ride id), so a big message is
    //      either a mistake or an attack, and Socket.io drops that connection.
    const io = new Server(server, {
        cors: corsConfig,
        maxHttpBufferSize: 10 * 1024,
    })

    // 2) The guard: runs once for every new connection, BEFORE it is accepted.
    //    No valid token means no connection (see socketAuth.js).
    io.use(socketAuth)

    // 3) This runs every time someone connects successfully.
    //    "socket" is ONE connection (one phone). socket.user was filled in
    //    by socketAuth: { id, roles, exp }.
    io.on('connection', (socket) => {
        const userId = socket.user.id

        // 4) Personal room: a room is just a name sockets can join.
        //    If the same person is logged in on two phones, both join this
        //    room, so a message to "user:<id>" reaches both.
        socket.join(`user:${userId}`)

        // We log only the user id, never the token
        console.log(`Socket connected: user ${userId} (${socket.id})`)

        // 5) Plug in the other socket files. Each one exports a function
        //    that receives (io, socket) and listens for its own events.
        //    NEW: these two files do not exist yet.
        //    Step 4: remove the // in front of the driverSocket line
        //    Step 5: remove the // in front of the rideSocket line
        require('./driverSocket')(io, socket)
        // require('./rideSocket')(io, socket)

        // 6) A broken connection or a bad message must never crash the server.
        //    Socket.io emits "error" on the socket, and an unhandled one can
        //    stop the program, so we log it and carry on.
        socket.on('error', (err) => {
            console.error(`Socket error for user ${userId}:`, err.message)
        })

        // 7) The phone left: normal close, lost signal, app killed, and so on.
        //    Socket.io removes the socket from every room by itself.
        //    "reason" says why, for example 'transport close' (signal lost).
        socket.on('disconnect', (reason) => {
            console.log(`Socket disconnected: user ${userId} (${reason})`)
        })
    })

    return io
}

module.exports = initSockets