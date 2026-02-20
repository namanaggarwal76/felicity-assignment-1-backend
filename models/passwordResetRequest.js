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
      type: String,
      select: false,
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

module.exports = mongoose.model("PasswordResetRequest", passwordResetRequestSchema);
