const multer = require("multer");
const path = require("path");
const fs = require("fs");

// create directory if doesnt exist
const uploadDir = path.join(__dirname, "../uploads/form-files");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// configure storage for multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, `form-${uniqueSuffix}${ext}`);
    },
});

// Allowed types (more flexible for form uploads)
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        "image/jpeg", "image/jpg", "image/png",
        "application/pdf",
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(
            new Error("Invalid file type. Allowed: JPG, PNG, PDF"),
            false,
        );
    }
};

const formFileUpload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 mb limit
    },
    fileFilter: fileFilter,
});

module.exports = formFileUpload;
