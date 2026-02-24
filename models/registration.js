const mongoose = require("mongoose");

const scanHistorySchema = new mongoose.Schema(
  {
    timestamp: {
      type: Date,
      default: Date.now,
    },
    action: {
      type: String,
      enum: [
        "scanned",
        "manual_present",
        "manual_absent",
        "duplicate_rejected",
      ],
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
    },
    notes: String,
  },
  { _id: false },
);

const registrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    registrationDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["registered", "attended", "cancelled", "rejected", "pending_approval"],
      default: "registered",
    },
    registrationApprovalStatus: {
      type: String,
      enum: ["not_required", "pending", "approved", "rejected"],
      default: "not_required",
    },
    registrationApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
    },
    registrationApprovalDate: {
      type: Date,
    },
    registrationRejectionReason: {
      type: String,
      trim: true,
    },
    ticketId: {
      type: String,
      unique: true,
    },
    // Encrypted QR code data
    qrCodeEncrypted: {
      type: String,
    },
    qrCodeIV: {
      type: String,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "completed", "free"],
      default: "free",
    },
    paymentProofImage: {
      type: String,
      default: null,
    },
    paymentApprovalStatus: {
      type: String,
      enum: ["not_required", "pending", "approved", "rejected"],
      default: "not_required",
    },
    paymentApprovalDate: {
      type: Date,
    },
    paymentRejectionReason: {
      type: String,
      trim: true,
    },
    paymentApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
    },
    attendanceStatus: {
      type: String,
      enum: ["not_checked", "present", "absent"],
      default: "not_checked",
    },
    attendanceTimestamp: {
      type: Date,
    },
    attendanceMarkedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
    },
    manualOverride: {
      type: Boolean,
      default: false,
    },
    overrideReason: {
      type: String,
      trim: true,
    },
    scanHistory: [scanHistorySchema],
    merchandiseSelection: {
      variantId: String,
      quantity: Number,
    },
    formData: [
      {
        fieldId: String,
        value: mongoose.Schema.Types.Mixed,
      },
    ],
    teamName: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Registration", registrationSchema);
