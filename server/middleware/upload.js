// middleware/upload.js
// Reads the three vehicle documents (cnic, license, registration) from a
// "multipart/form-data" request and checks them BEFORE the controller runs.
// The files are kept in memory (RAM), not saved on disk, because
// uploadService sends them straight to Cloudinary.

const multer = require('multer')

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB per file

// The only file types we accept
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

// The three file "slots" the driver may fill. Each slot takes one file.
// These names are the field names the app and Postman must use.
const DOCUMENT_FIELDS = [
    { name: 'cnic', maxCount: 1 },
    { name: 'license', maxCount: 1 },
    { name: 'registration', maxCount: 1 },
]

// ---------------------------------------------------------------
// Step 1: the multer reader
// ---------------------------------------------------------------
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 3 },
    // Runs for every file. It checks the type the client CLAIMS the file has.
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_TYPES.includes(file.mimetype)) {
            const err = new Error('Only JPEG, PNG or PDF files are allowed')
            err.code = 'INVALID_FILE_TYPE'
            return cb(err)
        }
        cb(null, true)
    },
}).fields(DOCUMENT_FIELDS)

// ---------------------------------------------------------------
// Step 2: check the file's REAL type.
// A client can lie about the type, so we also look at the first bytes of
// the file. Every JPEG, PNG and PDF starts with a fixed "signature".
// ---------------------------------------------------------------
const looksLikeAllowedFile = (buffer) => {
    if (!buffer || buffer.length < 4) return false

    // JPEG starts with FF D8 FF
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF
    // PNG starts with 89 50 4E 47 (the letters "PNG" after a special byte)
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
    // PDF starts with the text "%PDF"
    const isPdf = buffer.slice(0, 4).toString('latin1') === '%PDF'

    return isJpeg || isPng || isPdf
}

// ---------------------------------------------------------------
// The middleware that routes will use.
// After it runs successfully:
//   req.files.cnic[0], req.files.license[0], req.files.registration[0]
//   each has: buffer, mimetype, originalname, size
//   req.body has the normal text fields (model, fuelType, ...)
// ---------------------------------------------------------------
const uploadVehicleDocuments = (req, res, next) => {
    upload(req, res, (err) => {
        // 1) Multer or the file filter found a problem: send a short, clear message
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large. The maximum size is 5 MB per file' })
                }
                if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                    return res.status(400).json({ error: 'Unexpected file field. Use only cnic, license and registration' })
                }
                return res.status(400).json({ error: 'Invalid file upload' })
            }
            if (err.code === 'INVALID_FILE_TYPE') {
                return res.status(400).json({ error: err.message })
            }
            console.error('Upload error:', err) // details stay in the server log only
            return res.status(500).json({ error: 'File upload failed' })
        }

        // 2) Check the real type of every file that arrived
        const files = req.files || {}
        for (const fieldName of Object.keys(files)) {
            for (const file of files[fieldName]) {
                if (!looksLikeAllowedFile(file.buffer)) {
                    return res.status(400).json({ error: `The ${fieldName} file is not a real JPEG, PNG or PDF` })
                }
            }
        }

        // 3) All good: go on to the controller
        next()
    })
}

module.exports = { uploadVehicleDocuments }