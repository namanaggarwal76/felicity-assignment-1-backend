const mongoose = require("mongoose");

const passwordResetRequestSchema = new mongoose.Schema(
  {
    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    adminComment: {
      type: String,
      trim: true,
    },
    newPassword: {
      type: String, // Store temporarily when approved, admin can share it
      select: false, // Don't include by default
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    reviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
passwordResetRequestSchema.index({ clubId: 1, status: 1 });
passwordResetRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PasswordResetRequest", passwordResetRequestSchema);
