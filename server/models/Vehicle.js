// models/Vehicle.js
// A driver's vehicle. A new vehicle starts as "pending" and only an ADMIN
// can approve or reject it. Matching and accepting rides need "approved".

const mongoose = require('mongoose')

// ---------------------------------------------------------------
// One uploaded document (CNIC, license or registration proof).
// The files are PRIVATE in Cloudinary, so we store the file's id (publicId),
// not an open link. The admin gets a short-lived signed link from the server.
// "_id: false" stops Mongoose adding a pointless id to each document.
// ---------------------------------------------------------------
const documentSchema = new mongoose.Schema({
    publicId: { type: String, required: true },   // the file's id inside Cloudinary
    resourceType: { type: String },               // 'image' or 'raw' (needed to build the signed link)
    format: { type: String },                     // jpg, png or pdf
    uploadedAt: { type: Date, default: Date.now },
}, { _id: false })

const vehicleSchema = new mongoose.Schema({
    driver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    model: {
        type: String,
        required: true,
    },
    engineSize: {
        type: String,
    },
    fuelType: {
        type: String,
        enum: ['petrol', 'cng', 'hybrid', 'ev'],
        required: true,
    },
    vehicleType: {
        type: String,
        enum: ['bike', 'rickshaw', 'car', 'van'],
        required: true,
    },

    // registered = has a plate number and the registration book or card
    // applied    = new vehicle, owner applied for registration, plate not issued yet
    registrationStatus: {
        type: String,
        enum: ['registered', 'applied'],
        required: true,
    },

    // Required ONLY for registered vehicles, because a brand new vehicle
    // may not have a plate yet.
    registrationNumber: {
        type: String,
        trim: true,
        uppercase: true,
        required: function () {
            return this.registrationStatus === 'registered'
        },
    },

    // For "applied" vehicles the admin sets a deadline when approving.
    // After this date the vehicle cannot take rides until the plate is added.
    registrationDeadline: {
        type: Date,
    },

    // The three documents. The "registration" document is the registration
    // book/card for a registered vehicle, or the dealer invoice / excise
    // application receipt for an applied vehicle.
    documents: {
        cnic: { type: documentSchema },
        license: { type: documentSchema },
        registration: { type: documentSchema },
    },

    // NEW: the plate number and registration paper an "applied" vehicle's owner
    // sent AFTER the plate was issued. They wait here until an admin approves.
    // The vehicle keeps its normal status while this is under review.
    pendingRegistration: {
        registrationNumber: { type: String, trim: true, uppercase: true },
        document: { type: documentSchema },
        submittedAt: { type: Date },
    },

    // NEW: why the admin rejected the last plate submission, so the driver can fix it.
    // Cleared when the driver submits again, or when the admin approves.
    registrationRejectionReason: {
        type: String,
    },

    // pending  = driver submitted it, admin has not looked yet
    // approved = admin checked it, the vehicle may be used for rides
    // rejected = admin refused it (see rejectionReason)
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
    },

    // Why the admin rejected the vehicle, so the driver can fix the problem
    rejectionReason: {
        type: String,
    },

    // Which admin made the decision, and when (an audit trail)
    verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    verifiedAt: {
        type: Date,
    },
}, { timestamps: true })

// ---------------------------------------------------------------
// ONE place that decides "may this vehicle take rides right now?"
// driverController, matchingService and rideController all call this,
// so the rule can never differ between files.
//   1) the admin must have approved it
//   2) a registered vehicle is fine
//   3) an applied vehicle is fine only until its deadline
// ---------------------------------------------------------------
vehicleSchema.methods.canTakeRides = function () {
    if (this.status !== 'approved') return false

    // Applied vehicle: needs a deadline that has not passed yet
    if (this.registrationStatus === 'applied') {
        return Boolean(this.registrationDeadline) && this.registrationDeadline.getTime() > Date.now()
    }

    // Registered (or an older test vehicle with no registrationStatus)
    return true
}

// The admin's "pending vehicles" list and the matching queries search by status
vehicleSchema.index({ status: 1 })

// Looking up a vehicle by plate (used to warn about duplicates)
vehicleSchema.index({ registrationNumber: 1 })

// NEW: the admin's list of plate submissions waiting for review
vehicleSchema.index({ 'pendingRegistration.submittedAt': 1 })

module.exports = mongoose.model('Vehicle', vehicleSchema)