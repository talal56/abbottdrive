// services/uploadService.js
// Talks to Cloudinary. Controllers never call Cloudinary directly,
// they call the functions in this file (same rule as osrmService).
//
// The documents are uploaded as PRIVATE files (type: 'authenticated').
// A private file has no open link. To look at it, the server makes a
// temporary signed link that stops working after a few minutes.

const cloudinary = require('cloudinary').v2

const SIGNED_LINK_SECONDS = 10 * 60 // a signed link works for 10 minutes

// ---------------------------------------------------------------
// Helper: connect to Cloudinary using the values in .env.
// It runs when a function is used (not when the file loads), so the
// .env values are always ready and a missing value gives a clear error.
// ---------------------------------------------------------------
let configured = false
const ensureConfigured = () => {
    if (configured) return

    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        throw new Error('Cloudinary settings are missing in .env')
    }

    cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
        secure: true, // always use https
    })
    configured = true
}

// ---------------------------------------------------------------
// Upload ONE file (the file object comes from multer: it has file.buffer).
// Returns what we store in the database: { publicId, resourceType, format }
// ---------------------------------------------------------------
const uploadDocument = (file, folder) => {
    ensureConfigured()

    // Cloudinary reads the file as a stream, so we wrap it in a Promise
    // to be able to use "await" in the controller.
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,                    // e.g. abbottdrive/vehicle-docs/<driverId>
                type: 'authenticated',     // PRIVATE: no open link works
                resource_type: 'auto',     // let Cloudinary detect image or pdf
                unique_filename: true,     // random file name, never the original name
                use_filename: false,       // the original name could contain personal data
                overwrite: false,
            },
            (error, result) => {
                if (error) return reject(error)
                resolve({
                    publicId: result.public_id,
                    resourceType: result.resource_type,
                    format: result.format,
                })
            }
        )
        stream.end(file.buffer) // send the file bytes
    })
}

// ---------------------------------------------------------------
// Delete ONE stored document. It never throws, because it is used for
// clean-up, and a clean-up problem must not hide the real error.
// ---------------------------------------------------------------
const deleteDocument = async (doc) => {
    if (!doc || !doc.publicId) return
    try {
        ensureConfigured()
        await cloudinary.uploader.destroy(doc.publicId, {
            resource_type: doc.resourceType || 'image',
            type: 'authenticated',
        })
    } catch (err) {
        console.error('deleteDocument error:', err.message)
    }
}

// ---------------------------------------------------------------
// Upload all the documents of one request.
// Input : files = req.files from multer, driverId = the owner's id
// Output: { cnic, license, registration } (only the ones that were sent)
// If one upload fails, the ones that already went through are deleted,
// so we never leave half a set of documents in Cloudinary.
// ---------------------------------------------------------------
const uploadVehicleDocuments = async (files, driverId) => {
    const folder = `abbottdrive/vehicle-docs/${driverId}`
    const slots = ['cnic', 'license', 'registration']
    const uploaded = {}

    try {
        for (const slot of slots) {
            if (files && files[slot] && files[slot][0]) {
                uploaded[slot] = await uploadDocument(files[slot][0], folder)
            }
        }
        return uploaded
    } catch (err) {
        // Roll back: delete everything uploaded so far
        for (const slot of Object.keys(uploaded)) {
            await deleteDocument(uploaded[slot])
        }
        throw err // the controller's catch will log it and answer with a short error
    }
}

// ---------------------------------------------------------------
// Make a temporary signed link for ONE stored document (for the admin).
// Returns null if the document does not exist.
// ---------------------------------------------------------------
const getSignedUrl = (doc, seconds = SIGNED_LINK_SECONDS) => {
    if (!doc || !doc.publicId) return null
    ensureConfigured()

    const expiresAt = Math.floor(Date.now() / 1000) + seconds // time in seconds since 1970

    return cloudinary.utils.private_download_url(doc.publicId, doc.format, {
        resource_type: doc.resourceType || 'image',
        type: 'authenticated',
        expires_at: expiresAt,
    })
}

// Signed links for all three documents of a vehicle: { cnic, license, registration }
const getSignedUrls = (documents) => {
    const docs = documents || {}
    return {
        cnic: getSignedUrl(docs.cnic),
        license: getSignedUrl(docs.license),
        registration: getSignedUrl(docs.registration),
    }
}

module.exports = {
    uploadDocument,
    deleteDocument,
    uploadVehicleDocuments,
    getSignedUrl,
    getSignedUrls,
}