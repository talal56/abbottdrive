// controllers/vehicleController.js
// A user registers a vehicle and uploads the three documents.
// The vehicle always starts as "pending". Only an ADMIN can approve it
// (adminController), so this file never reads status from the request.

const Vehicle = require('../models/Vehicle')
const uploadService = require('../services/uploadService')

const FUEL_TYPES = ['petrol', 'cng', 'hybrid', 'ev']
const VEHICLE_TYPES = ['bike', 'rickshaw', 'car', 'van']
const REGISTRATION_STATUSES = ['registered', 'applied']

// A plate may have capital letters, digits, spaces and dashes (3 to 15 characters)
const PLATE_PATTERN = /^[A-Z0-9 -]{3,15}$/

// ---------------------------------------------------------------
// Helper: the vehicle data we are allowed to send back.
// We NEVER send documents.publicId. We only say whether each document exists.
// (The admin gets signed links from adminController instead.)
// ---------------------------------------------------------------
const publicVehicle = (vehicle) => ({
    id: vehicle._id,
    model: vehicle.model,
    engineSize: vehicle.engineSize,
    fuelType: vehicle.fuelType,
    vehicleType: vehicle.vehicleType,
    registrationStatus: vehicle.registrationStatus,
    registrationNumber: vehicle.registrationNumber,
    registrationDeadline: vehicle.registrationDeadline,
    status: vehicle.status,
    rejectionReason: vehicle.rejectionReason,
    documents: {
        cnic: Boolean(vehicle.documents && vehicle.documents.cnic),
        license: Boolean(vehicle.documents && vehicle.documents.license),
        registration: Boolean(vehicle.documents && vehicle.documents.registration),
    },
    createdAt: vehicle.createdAt,
})

// ---------------------------------------------------------------
// ANY LOGGED-IN USER: register a vehicle
// Request type: multipart/form-data (Body > form-data in Postman)
//   Text fields: model, engineSize (optional), fuelType, vehicleType,
//                registrationStatus ('registered' or 'applied'),
//                registrationNumber (only for 'registered')
//   File fields: cnic, license, registration
// Every new account is a rider, so anyone may register a vehicle.
// Driver mode only unlocks after an admin approves the driver.
// ---------------------------------------------------------------
const registerVehicle = async (req, res) => {
    // We keep the uploaded info here so the "catch" below can clean up
    let uploadedDocs = null

    try {
        const userId = req.user.id

        // 1) Read ONLY the text fields we allow.
        //    We never read status, verifiedBy or registrationDeadline,
        //    otherwise a driver could approve their own vehicle.
        const body = req.body || {}
        const model = typeof body.model === 'string' ? body.model.trim() : ''
        const engineSize = typeof body.engineSize === 'string' ? body.engineSize.trim() : ''
        const { fuelType, vehicleType, registrationStatus } = body

        // 2) Check the text fields
        if (model === '' || model.length > 100) {
            return res.status(400).json({ error: 'Vehicle model is required (up to 100 characters)' })
        }
        if (engineSize.length > 50) {
            return res.status(400).json({ error: 'Engine size is too long' })
        }
        if (!FUEL_TYPES.includes(fuelType)) {
            return res.status(400).json({ error: 'Invalid fuel type' })
        }
        if (!VEHICLE_TYPES.includes(vehicleType)) {
            return res.status(400).json({ error: 'Invalid vehicle type' })
        }
        if (!REGISTRATION_STATUSES.includes(registrationStatus)) {
            return res.status(400).json({ error: 'registrationStatus must be "registered" or "applied"' })
        }

        // 3) Plate number: required for "registered", ignored for "applied"
        //    (a new vehicle may not have a plate yet).
        let registrationNumber
        if (registrationStatus === 'registered') {
            const raw = typeof body.registrationNumber === 'string' ? body.registrationNumber : ''
            // trim, capitals, and many spaces become one space
            registrationNumber = raw.trim().toUpperCase().replace(/\s+/g, ' ')

            if (!PLATE_PATTERN.test(registrationNumber)) {
                return res.status(400).json({ error: 'Enter a valid registration number' })
            }

            // The same plate cannot belong to two active vehicles.
            // A REJECTED vehicle does not count, so its owner can try again.
            const duplicate = await Vehicle.findOne({
                registrationNumber,
                status: { $ne: 'rejected' },
            })
            if (duplicate) {
                return res.status(409).json({ error: 'This registration number is already registered' })
            }
        }

        // 4) All three documents are required for a NEW vehicle.
        //    For "applied" vehicles, the registration file is the dealer invoice
        //    or the excise application receipt.
        const files = req.files || {}
        const missing = ['cnic', 'license', 'registration'].filter((slot) => !(files[slot] && files[slot][0]))
        if (missing.length > 0) {
            return res.status(400).json({ error: `Missing document(s): ${missing.join(', ')}` })
        }

        // 5) One pending vehicle at a time. This stops someone filling
        //    Cloudinary with files by sending the form again and again.
        const alreadyPending = await Vehicle.findOne({ driver: userId, status: 'pending' })
        if (alreadyPending) {
            return res.status(409).json({ error: 'You already have a vehicle waiting for review' })
        }

        // 6) Upload the three files to Cloudinary (private).
        //    If one upload fails, uploadService deletes the ones already sent.
        uploadedDocs = await uploadService.uploadVehicleDocuments(files, userId)

        // 7) Save the vehicle. The status is "pending" by default (see Vehicle.js).
        const vehicle = await Vehicle.create({
            driver: userId,
            model,
            engineSize: engineSize || undefined,
            fuelType,
            vehicleType,
            registrationStatus,
            registrationNumber, // undefined for "applied" vehicles
            documents: uploadedDocs,
        })

        res.status(201).json({ vehicle: publicVehicle(vehicle) })
    } catch (err) {
        // If the files were uploaded but saving the vehicle failed, delete the
        // files so we do not leave personal documents with no owner.
        if (uploadedDocs) {
            for (const slot of Object.keys(uploadedDocs)) {
                await uploadService.deleteDocument(uploadedDocs[slot])
            }
        }

        // Bad data that slipped past our checks: a short message, not a crash
        if (err.name === 'ValidationError') {
            console.error('registerVehicle validation error:', err.message)
            return res.status(400).json({ error: 'Invalid vehicle details' })
        }

        console.error('registerVehicle error:', err) // details stay in the server log
        res.status(500).json({ error: 'Failed to register vehicle' })
    }
}

// ---------------------------------------------------------------
// ANY LOGGED-IN USER: list my own vehicles, newest first
// ---------------------------------------------------------------
const getMyVehicles = async (req, res) => {
    try {
        const vehicles = await Vehicle.find({ driver: req.user.id }).sort({ createdAt: -1 })
        res.status(200).json({ vehicles: vehicles.map(publicVehicle) })
    } catch (err) {
        console.error('getMyVehicles error:', err)
        res.status(500).json({ error: 'Failed to fetch vehicles' })
    }
}

module.exports = { registerVehicle, getMyVehicles }