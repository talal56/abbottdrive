// services/osrmService.js
// Asks the OSRM routing server for the road distance and time between two points.
// NOTE: the public demo server is for light testing only.
// For a real launch, run your own OSRM server and set OSRM_URL in .env.

const getRoute = async (pickupCoords, dropCoords) => {
    const baseUrl = process.env.OSRM_URL || 'https://router.project-osrm.org'

    // OSRM wants "longitude,latitude" pairs separated by a semicolon
    const url = `${baseUrl}/route/v1/driving/${pickupCoords[0]},${pickupCoords[1]};` +
                `${dropCoords[0]},${dropCoords[1]}?overview=false`

    // Give up after 8 seconds so a slow routing server cannot hang our API
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) {
            throw new Error(`OSRM request failed with status ${response.status}`)
        }

        const data = await response.json()
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            throw new Error('No route found between these points')
        }

        const route = data.routes[0] // distance in metres, duration in seconds
        return {
            distanceKm: Math.round((route.distance / 1000) * 100) / 100, // 2 decimals
            durationMin: Math.max(1, Math.round(route.duration / 60)),
        }
    } finally {
        clearTimeout(timer) // always stop the timer
    }
}

module.exports = { getRoute }