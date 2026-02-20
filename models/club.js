const mongoose = require("mongoose");

const clubSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
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
    description: {
      type: String,
      required: false,
    },
    category: {
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
        "Other",
      ],
      default: "Other",
    },
    followers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        followedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    followerCount: {
      type: Number,
      default: 0,
    },
    contactEmail: {
      type: String,
      required: false,
    },
    phoneNumber: {
      type: String,
      trim: true,
      required: false,
    },
    website: {
      type: String,
      trim: true,
      required: false,
    },
    socialLinks: {
      instagram: { type: String, required: false },
      twitter: { type: String, required: false },
      facebook: { type: String, required: false },
      linkedin: { type: String, required: false },
    },
    totalEvents: {
      type: Number,
      default: 0,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    discordWebhook: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

clubSchema.pre("save", function () {
  this.followerCount = this.followers.length;
});

module.exports = mongoose.model("Club", clubSchema);
