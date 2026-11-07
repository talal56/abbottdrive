// config/corsConfig.js
// NEW FILE. Decides which WEBSITES may call our API from a browser.
// app.js will use it like this:  app.use(cors(corsConfig))  (step 5)
//
// Mobile apps and Postman send NO "Origin" header, so CORS does not
// apply to them. Only the admin website (a browser) is checked here.

// The allowed origins come from CLIENT_ORIGINS in .env, already cleaned
// and turned into an array by env.js.
// Example: CLIENT_ORIGINS=http://localhost:5173,https://your-admin.vercel.app
const env = require('./env')

// ---------------------------------------------------------------
// The function the cors package calls for every request.
// origin   : the website address the browser says it comes from
//            (undefined when the request is not from a browser)
// callback : callback(null, true) = allow, callback(null, false) = do not allow
// ---------------------------------------------------------------
const checkOrigin = (origin, callback) => {
    // 1) No Origin header: a mobile app, Postman or a server. Allow it.
    if (!origin) {
        return callback(null, true)
    }

    // 2) The website is on our list: allow it
    if (env.CLIENT_ORIGINS.includes(origin)) {
        return callback(null, true)
    }

    // 3) Any other website: do not add the CORS headers, so the browser
    //    blocks the response. We do NOT throw an error here, because the
    //    error handler would turn it into a confusing 500 message.
    return callback(null, false)
}

module.exports = {
    origin: checkOrigin,

    // Only the request types our API really uses
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],

    // Only the headers our API really reads:
    // Content-Type for JSON, Authorization for the "Bearer <token>"
    allowedHeaders: ['Content-Type', 'Authorization'],

    // We send tokens in the Authorization header, not in cookies,
    // so the browser does not need to send cookies to us
    credentials: false,

    // The browser may remember the answer to its "may I?" check for 10 minutes
    // (in seconds), so it does not ask before every single request
    maxAge: 600,
}