const multer = require("multer");
const path = require("path");
const fs = require("fs");

// create directory if doesnt exist
const uploadDir = path.join(__dirname, "../uploads/payment-proofs");
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
    cb(null, `payment-${uniqueSuffix}${ext}`);
  },
});

// only images allowed
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true); // cb is a callback function that takes error and boolean (true if file is accepted)
  } else {
    cb(
      new Error("Invalid file type. Only JPEG and PNG images are allowed."),
      false,
    );
  }
};

const paymentProofUpload = multer({
  storage: storage,
  limits: {
    fileSize: 5*1024*1024, // 5 mb limit
  },
  fileFilter: fileFilter,
});

module.exports = paymentProofUpload;
