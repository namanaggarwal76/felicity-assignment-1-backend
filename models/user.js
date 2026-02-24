const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    isIIITian: {
      type: Boolean,
      default: false,
    },
    collegeName: {
      type: String,
      trim: true,
    },
    contactNumber: {
      type: String,
      trim: true,
    },
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },
    interests: [
      {
        type: String,
        enum: [
          "Music",
          "Art",
          "Sports",
          "Technology",
          "Literature",
          "Photography",
          "Dance",
          "Gaming",
        ],
      },
    ],
    followedClubs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Club",
      },
    ],
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("User", userSchema);
