const mongoose = require("mongoose");

const reactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    emoji: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

const discussionSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "authorType",
      required: true,
    },
    authorType: {
      type: String,
      enum: ["User", "Club"],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    isAnnouncement: {
      type: Boolean,
      default: false,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    parentMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Discussion",
      default: null,
    },
    reactions: [reactionSchema],
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Discussion", discussionSchema);
