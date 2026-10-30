// services/fareService.js
// Works out the fare RANGE (min and max) for a trip using simple rules.
// Later, the AI service will add its own prediction on top of this.

// ---------------------------------------------------------------
// SAMPLE RATES: THESE ARE MADE-UP NUMBERS FOR TESTING ONLY.
// Replace them with real values from your Abbottabad survey.
// (Later they will move into a Settings model that the admin edits.)
//   baseFare : fixed charge for starting any trip (Rs)
//   perKm    : charge for every kilometre (Rs)
//   perMin   : charge for every minute of travel (Rs)
//   minFare  : the lowest fare we will ever show (Rs)
// ---------------------------------------------------------------
const SAMPLE_RATES = {
    bike:     { baseFare: 30,  perKm: 15, perMin: 1,   minFare: 80 },
    rickshaw: { baseFare: 50,  perKm: 25, perMin: 1.5, minFare: 120 },
    car:      { baseFare: 80,  perKm: 40, perMin: 2,   minFare: 200 },
    van:      { baseFare: 100, perKm: 50, perMin: 2.5, minFare: 250 },
}

// The range is 10% below and 10% above the calculated fare
const LOWER_FACTOR = 0.9
const UPPER_FACTOR = 1.1

// Rounds a number to the nearest 10 rupees. Example: 273.6 becomes 270
const roundToTen = (amount) => Math.round(amount / 10) * 10

// ---------------------------------------------------------------
// Main function: called by rideController.createRide
// Input : { distanceKm, durationMin, vehicleType }
// Output: { min, max } in whole rupees
// It is "async" so the controller's "await" works now, and so we can
// call the AI service inside it later without changing the controller.
// ---------------------------------------------------------------
const calculateFare = async ({ distanceKm, durationMin, vehicleType }) => {
    // 1) Find the rates for this vehicle type
    const rates = SAMPLE_RATES[vehicleType]
    if (!rates) {
        throw new Error(`No fare rates for vehicle type "${vehicleType}"`)
    }

    // 2) Make sure the numbers are real, positive numbers
    if (typeof distanceKm !== 'number' || !(distanceKm > 0)) {
        throw new Error('distanceKm must be a number greater than 0')
    }
    if (typeof durationMin !== 'number' || !(durationMin > 0)) {
        throw new Error('durationMin must be a number greater than 0')
    }

    // 3) Rule fare = base + (distance x per-km) + (time x per-minute)
    const ruleFare = rates.baseFare + (distanceKm * rates.perKm) + (durationMin * rates.perMin)

    // 4) Make the range: 10% below and 10% above, rounded to Rs 10
    let min = roundToTen(ruleFare * LOWER_FACTOR)
    let max = roundToTen(ruleFare * UPPER_FACTOR)

    // 5) Never go below the minimum fare for this vehicle
    if (min < rates.minFare) {
        min = rates.minFare
    }

    // 6) The top of the range must never be lower than the bottom
    if (max < min) {
        max = min
    }

    return { min, max }
}

module.exports = { calculateFare }