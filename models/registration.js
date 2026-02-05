const mongoose = require('mongoose');

// Scan history schema for audit logging
const scanHistorySchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  action: {
    type: String,
    enum: ['scanned', 'manual_present', 'manual_absent', 'duplicate_rejected'],
    required: true
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club'
  },
  notes: String
}, { _id: false });

const registrationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  registrationDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['registered', 'attended', 'cancelled', 'rejected'],
    default: 'registered'
  },
  ticketId: {
    type: String,
    unique: true
  },
  // Encrypted QR code data
  qrCodeEncrypted: {
    type: String
  },
  qrCodeIV: {
    type: String
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'free'],
    default: 'free'
  },

  // ===== PAYMENT APPROVAL WORKFLOW (13.1.1) =====
  paymentProofImage: {
    type: String, // URL/path to uploaded image
    default: null
  },
  paymentApprovalStatus: {
    type: String,
    enum: ['not_required', 'pending', 'approved', 'rejected'],
    default: 'not_required'
  },
  paymentApprovalDate: {
    type: Date
  },
  paymentRejectionReason: {
    type: String,
    trim: true
  },
  paymentApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club'
  },

  // ===== ATTENDANCE TRACKING (13.1.2) =====
  attendanceStatus: {
    type: String,
    enum: ['not_checked', 'present', 'absent'],
    default: 'not_checked'
  },
  attendanceTimestamp: {
    type: Date
  },
  attendanceMarkedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club'
  },
  manualOverride: {
    type: Boolean,
    default: false
  },
  overrideReason: {
    type: String,
    trim: true
  },
  scanHistory: [scanHistorySchema],

  // Merchandise selection
  merchandiseSelection: {
    variantId: String,
    quantity: Number
  },
  // Answers to custom form
  formData: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  teamName: {
    type: String,
    trim: true
  }
}, { timestamps: true });

// Ensure unique registration per user per event
registrationSchema.index({ userId: 1, eventId: 1 }, { unique: true });

// Index for efficient attendance queries
registrationSchema.index({ eventId: 1, attendanceStatus: 1 });

// Index for payment approval queries
registrationSchema.index({ eventId: 1, paymentApprovalStatus: 1 });

module.exports = mongoose.model('Registration', registrationSchema);
