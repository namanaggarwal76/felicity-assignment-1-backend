const express = require("express");
const router = express.Router();
const Feedback = require("../models/feedback");
const Event = require("../models/event");
const Registration = require("../models/registration");
const authMiddleware = require("../middleware/authMiddleware");
const checkRole = require("../middleware/checkRole");

// POST /api/feedback/:eventId - Submit feedback for an event
router.post(
  "/:eventId",
  authMiddleware,
  checkRole(["user"]),
  async (req, res) => {
    try {
      const { eventId } = req.params;
      const { rating, comment } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ error: "Rating must be between 1 and 5" });
      }

      if (!comment || comment.trim().length === 0) {
        return res.status(400).json({ error: "Comment is required" });
      }

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      // Check if user attended the event
      const registration = await Registration.findOne({
        userId: req.user._id,
        eventId: eventId,
        status: "attended",
      });

      if (!registration) {
        return res
          .status(403)
          .json({ error: "Only attendees can submit feedback" });
      }

      // Check if feedback already exists
      const existingFeedback = await Feedback.findOne({
        userId: req.user._id,
        eventId: eventId,
      });

      if (existingFeedback) {
        return res
          .status(409)
          .json({ error: "Feedback already submitted for this event" });
      }

      const feedback = new Feedback({
        eventId,
        userId: req.user._id,
        rating: Number(rating),
        comment: comment.trim(),
        isAnonymous: true,
      });

      await feedback.save();

      res.status(201).json({ message: "Feedback submitted successfully" });
    } catch (error) {
      console.error("Error submitting feedback:", error);
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  },
);

// GET /api/feedback/:eventId - Get all feedback for an event (Organizer only)
router.get(
  "/:eventId",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { eventId } = req.params;
      const { rating } = req.query; // Optional filter by rating

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      // Check if user is the organizer
      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const query = { eventId };
      if (rating) {
        query.rating = Number(rating);
      }

      const feedbacks = await Feedback.find(query).sort({ createdAt: -1 });

      // Calculate statistics
      const totalFeedbacks = feedbacks.length;
      const averageRating =
        totalFeedbacks > 0
          ? feedbacks.reduce((sum, f) => sum + f.rating, 0) / totalFeedbacks
          : 0;

      const ratingDistribution = {
        5: feedbacks.filter((f) => f.rating === 5).length,
        4: feedbacks.filter((f) => f.rating === 4).length,
        3: feedbacks.filter((f) => f.rating === 3).length,
        2: feedbacks.filter((f) => f.rating === 2).length,
        1: feedbacks.filter((f) => f.rating === 1).length,
      };

      res.json({
        feedbacks: feedbacks.map((f) => ({
          _id: f._id,
          rating: f.rating,
          comment: f.comment,
          createdAt: f.createdAt,
        })),
        statistics: {
          totalFeedbacks,
          averageRating: averageRating.toFixed(2),
          ratingDistribution,
        },
      });
    } catch (error) {
      console.error("Error fetching feedback:", error);
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  },
);

// GET /api/feedback/:eventId/export - Export feedback as CSV (Organizer only)
router.get(
  "/:eventId/export",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { eventId } = req.params;

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const feedbacks = await Feedback.find({ eventId }).sort({
        createdAt: -1,
      });

      // Generate CSV content
      const headers = ["Rating", "Comment", "Submitted Date"];
      const rows = feedbacks.map((f) => [
        f.rating,
        `"${f.comment.replace(/"/g, '""')}"`, // Escape quotes in comments
        new Date(f.createdAt).toLocaleString(),
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.join(",")),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${event.name}_feedback.csv"`,
      );
      res.send(csvContent);
    } catch (error) {
      console.error("Error exporting feedback:", error);
      res.status(500).json({ error: "Failed to export feedback" });
    }
  },
);

// GET /api/feedback/user/can-submit/:eventId - Check if user can submit feedback
router.get(
  "/user/can-submit/:eventId",
  authMiddleware,
  checkRole(["user"]),
  async (req, res) => {
    try {
      const { eventId } = req.params;

      const registration = await Registration.findOne({
        userId: req.user._id,
        eventId: eventId,
        status: "attended",
      });

      if (!registration) {
        return res.json({ canSubmit: false, reason: "Not attended" });
      }

      const existingFeedback = await Feedback.findOne({
        userId: req.user._id,
        eventId: eventId,
      });

      if (existingFeedback) {
        return res.json({ canSubmit: false, reason: "Already submitted" });
      }

      res.json({ canSubmit: true });
    } catch (error) {
      console.error("Error checking feedback eligibility:", error);
      res.status(500).json({ error: "Failed to check eligibility" });
    }
  },
);

module.exports = router;
