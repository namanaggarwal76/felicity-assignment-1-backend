const mongoose = require("mongoose");

const FormFieldSchema = new mongoose.Schema({
  fieldId: { type: String, required: true },
  label: { type: String, required: true },
  type: {
    type: String,
    enum: [
      "text",
      "email",
      "number",
      "dropdown",
      "checkbox",
      "textarea",
      "file",
    ],
    required: true,
  },
  options: [{ type: String }],
  required: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
});

const MerchandiseVariantSchema = new mongoose.Schema({
  variantId: { type: String, required: true },
  size: String,
  color: String,
  stockQuantity: { type: Number, required: true, min: 0 },
  price: { type: Number, required: true, min: 0 },
});

const EventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String, required: true },

    organizerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Club",
      required: true,
    },

    eventType: {
      type: String,
      enum: ["normal", "merchandise"],
      required: true,
    },

    eligibility: {
      type: String,
      enum: ["all", "iiitans", "external"],
      default: "all",
    },

    // Dates
    registrationDeadline: { type: Date, required: true },
    eventStartDate: { type: Date, required: true },
    eventEndDate: { type: Date, required: true },

    // Registration
    registrationLimit: { type: Number, required: true, min: 1 },
    registrationFee: { type: Number, default: 0, min: 0 },
    requiresApproval: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["draft", "published", "ongoing", "completed", "closed"],
      default: "draft",
    },

    tags: [{ type: String, trim: true }],

    // Custom registration form for normal events
    customForm: {
      fields: [FormFieldSchema],
      locked: { type: Boolean, default: false },
    },

    // Merchandise-specific fields
    merchandiseDetails: {
      variants: [MerchandiseVariantSchema],
      purchaseLimit: { type: Number, default: 1 },
    },

    // Analytics
    totalRegistrations: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalAttendance: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Validate merchandise events have variants
EventSchema.pre("save", async function () {
  if (this.eventType === "merchandise") {
    if (
      !this.merchandiseDetails ||
      !this.merchandiseDetails.variants ||
      this.merchandiseDetails.variants.length === 0
    ) {
      throw new Error("Merchandise events must have at least one variant");
    }
  }
});

module.exports = mongoose.model("Event", EventSchema);
