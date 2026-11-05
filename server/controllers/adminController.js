// controllers/adminController.js
// Everything an ADMIN does to review a driver's vehicle submission.
// Only admins can reach these functions: adminRoutes.js puts
// authMiddleware and roleMiddleware(['admin']) in front of every one.

const mongoose = require('mongoose')
const Vehicle = require('../models/Vehicle')
const User = require('../models/User')
const uploadService = require('../services/uploadService')

const DEFAULT_DEADLINE_DAYS = 60 // days an "applied" vehicle may work without a plate [TO CONFIRM]
const MAX_DEADLINE_DAYS = 180    // the admin may not give more than this
const DAY_MS = 24 * 60 * 60 * 1000
const STATUSES = ['pending', 'approved', 'rejected']
const LIST_LIMIT = 50            // the most vehicles we return in one list

// ---------------------------------------------------------------
// Helper: the vehicle fields we send to the admin.
// We NEVER send a document's publicId. We only say whether it exists.
// Signed links come from getVehicleById.
// ---------------------------------------------------------------
const vehicleFields = (vehicle) => ({
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
    verifiedAt: vehicle.verifiedAt,
    documents: {
        cnic: Boolean(vehicle.documents && vehicle.documents.cnic),
        license: Boolean(vehicle.documents && vehicle.documents.license),
        registration: Boolean(vehicle.documents && vehicle.documents.registration),
    },
    // NEW: a plate submission waiting for review (null when there is none)
    pendingRegistration: vehicle.pendingRegistration && vehicle.pendingRegistration.submittedAt
        ? {
            registrationNumber: vehicle.pendingRegistration.registrationNumber,
            submittedAt: vehicle.pendingRegistration.submittedAt,
            hasDocument: Boolean(vehicle.pendingRegistration.document),
        }
        : null,
    // NEW: why the last plate submission was refused
    registrationRejectionReason: vehicle.registrationRejectionReason,
    createdAt: vehicle.createdAt,
})

// Same as above, plus the owner's details (the vehicle must be populated).
// The admin may see the phone number, because they may need to call the driver.
const adminVehicle = (vehicle) => ({
    ...vehicleFields(vehicle),
    driver: vehicle.driver
        ? {
            id: vehicle.driver._id,
            name: vehicle.driver.name,
            phone: vehicle.driver.phone,
            isDriverVerified: vehicle.driver.isDriverVerified,
        }
        : null, // the driver's account was deleted
})

// ---------------------------------------------------------------
// ADMIN: list vehicles by status, oldest first (a review queue)
// GET /api/admin/vehicles?status=pending     (pending is the default)
// ---------------------------------------------------------------
const listVehicles = async (req, res) => {
    try {
        const status = req.query.status || 'pending'
        if (!STATUSES.includes(status)) {
            return res.status(400).json({ error: 'status must be pending, approved or rejected' })
        }

        const vehicles = await Vehicle.find({ status })
            .sort({ createdAt: 1 }) // oldest first, so nobody waits forever
            .limit(LIST_LIMIT)
            .populate('driver', 'name phone isDriverVerified') // never load the password

        res.status(200).json({ count: vehicles.length, vehicles: vehicles.map(adminVehicle) })
    } catch (err) {
        console.error('listVehicles error:', err)
        res.status(500).json({ error: 'Failed to fetch vehicles' })
    }
}

// ---------------------------------------------------------------
// ADMIN: open ONE vehicle, with fresh 10-minute links to its documents
// GET /api/admin/vehicles/:id
// Links are made every time this runs and are never stored.
// ---------------------------------------------------------------
const getVehicleById = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid vehicle id' })
        }

        const vehicle = await Vehicle.findById(req.params.id)
            .populate('driver', 'name phone isDriverVerified')
        if (!vehicle) {
            return res.status(404).json({ error: 'Vehicle not found' })
        }

        res.status(200).json({
            vehicle: adminVehicle(vehicle),
            // FIXED: the links now also include the new registration paper (null if none is waiting)
            documentLinks: {
                ...uploadService.getSignedUrls(vehicle.documents), // cnic, license, registration
                pendingRegistration: uploadService.getSignedUrl(
                    vehicle.pendingRegistration && vehicle.pendingRegistration.document
                ),
            },
            linksValidMinutes: 10,
        })
    } catch (err) {
        console.error('getVehicleById error:', err)
        res.status(500).json({ error: 'Failed to fetch vehicle' })
    }
}

// ---------------------------------------------------------------
// ADMIN: approve a pending vehicle (and its driver)
// PATCH /api/admin/vehicles/:id/approve
// Optional body: { "deadlineDays": 60 }   (used only for "applied" vehicles)
// The submission holds the driver's CNIC and license too, so approving it
// also verifies the driver: adds the "driver" role and sets isDriverVerified.
// ---------------------------------------------------------------
const approveVehicle = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid vehicle id' })
        }

        // 1) How many days an "applied" vehicle may work without a plate
        let days = DEFAULT_DEADLINE_DAYS
        const { deadlineDays } = req.body || {}
        if (deadlineDays !== undefined) {
            if (!Number.isInteger(deadlineDays) || deadlineDays < 1 || deadlineDays > MAX_DEADLINE_DAYS) {
                return res.status(400).json({ error: `deadlineDays must be a whole number from 1 to ${MAX_DEADLINE_DAYS}` })
            }
            days = deadlineDays
        }

        // 2) Load the vehicle and check it can be approved
        const existing = await Vehicle.findById(req.params.id)
        if (!existing) {
            return res.status(404).json({ error: 'Vehicle not found' })
        }
        if (existing.status !== 'pending') {
            return res.status(409).json({ error: `This vehicle is already ${existing.status}` })
        }

        // Never approve a vehicle whose documents are missing
        const docs = existing.documents || {}
        if (!docs.cnic || !docs.license || !docs.registration) {
            return res.status(400).json({ error: 'Cannot approve: one or more documents are missing' })
        }

        // 3) Build the changes.
        //    $set writes fields, $unset removes them.
        const changes = {
            $set: { status: 'approved', verifiedBy: req.user.id, verifiedAt: new Date() },
            $unset: { rejectionReason: '' },
        }
        if (existing.registrationStatus === 'applied') {
            // No plate yet: the vehicle may work only until this date
            changes.$set.registrationDeadline = new Date(Date.now() + days * DAY_MS)
        } else {
            changes.$unset.registrationDeadline = ''
        }

        // 4) One atomic update: it works only if the vehicle is STILL "pending".
        //    If two admins click at the same moment, only the first one wins.
        const vehicle = await Vehicle.findOneAndUpdate(
            { _id: existing._id, status: 'pending' },
            changes,
            { returnDocument: 'after' }
        )
        if (!vehicle) {
            return res.status(409).json({ error: 'This vehicle was just reviewed by someone else' })
        }

        // 5) Verify the driver: add the "driver" role (no duplicates) and set the flag.
        //    If this step fails, we put the vehicle back to "pending", so the two
        //    records never disagree.
        try {
            const user = await User.findByIdAndUpdate(
                vehicle.driver,
                { $addToSet: { roles: 'driver' }, $set: { isDriverVerified: true } },
                { returnDocument: 'after' }
            )
            if (!user) {
                throw new Error('Driver account not found')
            }
        } catch (userErr) {
            await Vehicle.updateOne(
                { _id: vehicle._id },
                {
                    $set: { status: 'pending' },
                    $unset: { verifiedBy: '', verifiedAt: '', registrationDeadline: '' },
                }
            )
            throw userErr // the outer catch logs it and answers with a short error
        }

        res.status(200).json({
            vehicle: vehicleFields(vehicle),
            driverVerified: true,
            note: 'The driver must log in again to get a token with the driver role',
        })
    } catch (err) {
        console.error('approveVehicle error:', err)
        res.status(500).json({ error: 'Failed to approve vehicle' })
    }
}

// ---------------------------------------------------------------
// ADMIN: reject a pending vehicle, with a reason the driver can read
// PATCH /api/admin/vehicles/:id/reject
// Body: { "reason": "CNIC photo is blurry. Please upload a clear photo." }
// ---------------------------------------------------------------
const rejectVehicle = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid vehicle id' })
        }

        // 1) The reason is required, so the driver knows what to fix
        const { reason } = req.body || {}
        const cleanReason = typeof reason === 'string' ? reason.trim() : ''
        if (cleanReason.length < 5 || cleanReason.length > 255) {
            return res.status(400).json({ error: 'A rejection reason of 5 to 255 characters is required' })
        }

        // 2) Check the vehicle exists and is still waiting
        const existing = await Vehicle.findById(req.params.id)
        if (!existing) {
            return res.status(404).json({ error: 'Vehicle not found' })
        }
        if (existing.status !== 'pending') {
            return res.status(409).json({ error: `This vehicle is already ${existing.status}` })
        }

        // 3) One atomic update: only works while the vehicle is STILL "pending"
        const vehicle = await Vehicle.findOneAndUpdate(
            { _id: existing._id, status: 'pending' },
            {
                $set: {
                    status: 'rejected',
                    rejectionReason: cleanReason,
                    verifiedBy: req.user.id,
                    verifiedAt: new Date(),
                },
                $unset: { registrationDeadline: '' },
            },
            { returnDocument: 'after' }
        )
        if (!vehicle) {
            return res.status(409).json({ error: 'This vehicle was just reviewed by someone else' })
        }

        res.status(200).json({ vehicle: vehicleFields(vehicle) })
    } catch (err) {
        console.error('rejectVehicle error:', err)
        res.status(500).json({ error: 'Failed to reject vehicle' })
    }
}

// ---------------------------------------------------------------
// NEW. ADMIN: the queue of plate submissions waiting for review, oldest first
// GET /api/admin/registrations
// These are vehicles that are already approved and "applied", where the
// owner has sent the plate number and registration paper.
// ---------------------------------------------------------------
const listRegistrations = async (req, res) => {
    try {
        const vehicles = await Vehicle.find({
            status: 'approved',
            registrationStatus: 'applied',
            'pendingRegistration.submittedAt': { $exists: true },
        })
            .sort({ 'pendingRegistration.submittedAt': 1 }) // oldest first
            .limit(LIST_LIMIT)
            .populate('driver', 'name phone isDriverVerified')

        res.status(200).json({ count: vehicles.length, vehicles: vehicles.map(adminVehicle) })
    } catch (err) {
        console.error('listRegistrations error:', err)
        res.status(500).json({ error: 'Failed to fetch registration submissions' })
    }
}

// ---------------------------------------------------------------
// NEW. ADMIN: approve a plate submission
// PATCH /api/admin/vehicles/:id/registration/approve
// The vehicle becomes "registered", the plate is saved, the deadline is
// removed, and the new paper replaces the old dealer invoice.
// ---------------------------------------------------------------
const approveRegistration = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid vehicle id' })
        }

        // 1) Load the vehicle and check a submission is really waiting
        const existing = await Vehicle.findById(req.params.id)
        if (!existing) {
            return res.status(404).json({ error: 'Vehicle not found' })
        }

        const pending = existing.pendingRegistration
        if (existing.status !== 'approved' || existing.registrationStatus !== 'applied' ||
            !pending || !pending.submittedAt || !pending.registrationNumber || !pending.document) {
            return res.status(409).json({ error: 'No registration submission is waiting for this vehicle' })
        }

        // 2) Check the plate again. Another vehicle may have taken it since the driver sent it.
        //    This vehicle itself and rejected vehicles do not count.
        const duplicate = await Vehicle.findOne({
            _id: { $ne: existing._id },
            status: { $ne: 'rejected' },
            $or: [
                { registrationNumber: pending.registrationNumber },
                { 'pendingRegistration.registrationNumber': pending.registrationNumber },
            ],
        })
        if (duplicate) {
            return res.status(409).json({ error: 'This registration number is used by another vehicle. Reject this submission' })
        }

        // 3) Keep the OLD dealer invoice so we can delete it after the save works
        const oldDocument = existing.documents && existing.documents.registration

        // 4) One atomic update. The filter includes the exact submission time we just read,
        //    so it fails if the driver sent a new submission in the meantime.
        const vehicle = await Vehicle.findOneAndUpdate(
            {
                _id: existing._id,
                status: 'approved',
                registrationStatus: 'applied',
                'pendingRegistration.submittedAt': pending.submittedAt,
            },
            {
                $set: {
                    registrationStatus: 'registered',
                    registrationNumber: pending.registrationNumber,
                    // the new paper replaces the old invoice (copied as plain values)
                    'documents.registration': {
                        publicId: pending.document.publicId,
                        resourceType: pending.document.resourceType,
                        format: pending.document.format,
                        uploadedAt: pending.document.uploadedAt,
                    },
                },
                // the box is emptied and the deadline no longer applies
                $unset: {
                    pendingRegistration: '',
                    registrationDeadline: '',
                    registrationRejectionReason: '',
                },
            },
            { returnDocument: 'after' }
        )
        if (!vehicle) {
            return res.status(409).json({ error: 'This submission changed while you were reviewing it. Open the vehicle again' })
        }

        // 5) The old invoice is no longer needed. Deleting it keeps less personal data.
        //    deleteDocument never throws, so a clean-up problem cannot undo the approval.
        await uploadService.deleteDocument(oldDocument)

        res.status(200).json({ vehicle: vehicleFields(vehicle) })
    } catch (err) {
        console.error('approveRegistration error:', err)
        res.status(500).json({ error: 'Failed to approve registration' })
    }
}

// ---------------------------------------------------------------
// NEW. ADMIN: reject a plate submission, with a reason the driver can read
// PATCH /api/admin/vehicles/:id/registration/reject
// Body: { "reason": "The plate on the paper does not match what you typed" }
// The vehicle stays approved and its deadline is NOT changed.
// ---------------------------------------------------------------
const rejectRegistration = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: 'Invalid vehicle id' })
        }

        // 1) The reason is required, so the driver knows what to fix
        const { reason } = req.body || {}
        const cleanReason = typeof reason === 'string' ? reason.trim() : ''
        if (cleanReason.length < 5 || cleanReason.length > 255) {
            return res.status(400).json({ error: 'A rejection reason of 5 to 255 characters is required' })
        }

        // 2) Load the vehicle and check a submission is really waiting
        const existing = await Vehicle.findById(req.params.id)
        if (!existing) {
            return res.status(404).json({ error: 'Vehicle not found' })
        }

        const pending = existing.pendingRegistration
        if (existing.status !== 'approved' || existing.registrationStatus !== 'applied' ||
            !pending || !pending.submittedAt) {
            return res.status(409).json({ error: 'No registration submission is waiting for this vehicle' })
        }

        // 3) One atomic update: clear the box and save the reason.
        //    The filter includes the submission time, so a newer submission is never wiped.
        const vehicle = await Vehicle.findOneAndUpdate(
            {
                _id: existing._id,
                status: 'approved',
                registrationStatus: 'applied',
                'pendingRegistration.submittedAt': pending.submittedAt,
            },
            {
                $set: { registrationRejectionReason: cleanReason },
                $unset: { pendingRegistration: '' },
            },
            { returnDocument: 'after' }
        )
        if (!vehicle) {
            return res.status(409).json({ error: 'This submission changed while you were reviewing it. Open the vehicle again' })
        }

        // 4) Delete the refused paper from Cloudinary (it never throws)
        await uploadService.deleteDocument(pending.document)

        res.status(200).json({ vehicle: vehicleFields(vehicle) })
    } catch (err) {
        console.error('rejectRegistration error:', err)
        res.status(500).json({ error: 'Failed to reject registration' })
    }
}

module.exports = {
    listVehicles,
    getVehicleById,
    approveVehicle,
    rejectVehicle,
    listRegistrations,      // NEW
    approveRegistration,    // NEW
    rejectRegistration,     // NEW
}