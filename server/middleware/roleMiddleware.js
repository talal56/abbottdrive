const roleMiddleware = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.roles) {
            return res.status(401).json({ error: 'Not authenticated' })
        }

        const hasPermission = req.user.roles.some(role => allowedRoles.includes(role))

        if (!hasPermission) {
            return res.status(403).json({ error: 'Access denied' })
        }

        next()
    }
}

module.exports = roleMiddleware