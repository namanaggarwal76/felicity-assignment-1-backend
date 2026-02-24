const express = require("express");
const router = express.Router();
const Fuse = require("fuse.js");
const fs = require("fs");
const path = require("path");
const Event = require("../models/event");
const Registration = require("../models/registration");
const Club = require("../models/club");
const Discussion = require("../models/discussion");
const Feedback = require("../models/feedback");
const authMiddleware = require("../middleware/authMiddleware");
const checkRole = require("../middleware/checkRole");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const QRCode = require("qrcode");
const {
  generateEncryptedQRCode,
  sendRegistrationEmail,
  decryptQRData,
} = require("../utils/emailService");
const paymentProofUpload = require("../middleware/uploadMiddleware");
const formFileUpload = require("../middleware/formUploadMiddleware");

// GET /api/events/all - Get all events (Admin only)
router.get("/all", authMiddleware, checkRole(["admin"]), async (req, res) => {
  try {
    const events = await Event.find({})
      .populate("organizerId", "name email category")
      .sort({ createdAt: -1 });

    res.json({ events });
  } catch (error) {
    console.error("Error fetching all events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// Helper function to send Discord notification
async function sendDiscordNotification(club, event) {
  if (!club.discordWebhook) return;

  try {
    await axios.post(club.discordWebhook, {
      embeds: [
        {
          title: `New Event: ${event.name}`,
          description: event.description,
          fields: [
            {
              name: "Event Date",
              value: new Date(event.eventStartDate).toLocaleDateString(),
              inline: true,
            },
            {
              name: "Registration Fee",
              value:
                event.registrationFee > 0
                  ? `₹${event.registrationFee}`
                  : "Free",
              inline: true,
            },
            {
              name: "👥 Spots Available",
              value: `${event.registrationLimit}`,
              inline: true,
            },
            {
              name: "Registration Deadline",
              value: new Date(event.registrationDeadline).toLocaleString(),
              inline: false,
            },
          ],
          footer: {
            text: `Event Type: ${event.eventType} | Eligibility: ${event.eligibility}`,
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (error) {
    console.error("Discord webhook error:", error.message);
  }
}

// GET /api/events/trending - Get trending events (most registrations in last 24h)
router.get("/trending", async (req, res) => {
  try {
    const oneDayAgo = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);

    // Aggregate registrations from the last 24 hours
    const trendingStats = await Registration.aggregate([
      { $match: { registrationDate: { $gte: oneDayAgo } } },
      { $group: { _id: "$eventId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }, // Top 5 trending
      {
        $lookup: {
          from: "events",
          localField: "_id",
          foreignField: "_id",
          as: "event",
        },
      },
      { $unwind: "$event" },
      {
        $lookup: {
          from: "clubs",
          localField: "event.organizerId",
          foreignField: "_id",
          as: "club",
        },
      },
      { $unwind: "$club" },
      { $match: { "club.enabled": true, status: { $ne: "completed" } } },
    ]);

    if (trendingStats.length === 0) {
      return res.json({ events: [] });
    }

    // Extract event IDs
    const eventIds = trendingStats.map((stat) => stat._id);

    // Fetch full event details
    const events = await Event.find({ _id: { $in: eventIds } }).populate(
      "organizerId",
      "name email category",
    );

    // Map counts to events and sort them by the aggregation order
    const eventsWithCount = events
      .map((event) => {
        const stat = trendingStats.find(
          (s) => s._id.toString() === event._id.toString(),
        );
        return { ...event.toObject(), trendCount: stat ? stat.count : 0 };
      })
      .sort((a, b) => b.trendCount - a.trendCount);

    res.json({ events: eventsWithCount });
  } catch (error) {
    console.error("Error fetching trending events:", error);
    res.status(500).json({ error: "Failed to fetch trending events" });
  }
});

const query = {};

// GET /api/events - Get all published events (public) with filters
router.get("/", async (req, res) => {
  try {
    const {
      search,
      type,
      eligibility,
      startDate,
      endDate,
      organizerId,
      status,
    } = req.query;

    // Build status-based query with time-derivation logic
    const now = new Date();
    const statusArray = status ? status.split(",") : ["published", "ongoing"];
    const statusQueries = [];

    statusArray.forEach((s) => {
      if (s === "published") {
        // Effective 'published' (upcoming)
        statusQueries.push({
          status: "published",
          eventStartDate: { $gt: now },
        });
      } else if (s === "ongoing") {
        // Effective 'ongoing'
        statusQueries.push({
          $or: [
            {
              status: "published",
              eventStartDate: { $lte: now },
              eventEndDate: { $gt: now },
            },
            {
              status: "ongoing",
              eventEndDate: { $gt: now },
            },
          ],
        });
      } else if (s === "completed") {
        // Effective 'completed'
        statusQueries.push({
          $or: [
            { status: "completed" },
            {
              status: { $in: ["published", "ongoing"] },
              eventEndDate: { $lte: now },
            },
          ],
        });
      }
    });

    if (statusQueries.length > 0) {
      query.$or = statusQueries;
    }

    if (type) query.eventType = type;
    if (eligibility) query.eligibility = eligibility;

    if (startDate || endDate) {
      // If we already have $or from status, we need to wrap it in $and
      // but Mongoose handles multiple query keys as $and by default
      query.eventStartDate = query.eventStartDate || {};
      if (startDate) query.eventStartDate.$gte = new Date(startDate);
      if (endDate) query.eventStartDate.$lte = new Date(endDate);
    }

    // Filter out events from disabled clubs
    const disabledClubs = await Club.find({ enabled: false }, "_id");
    const disabledClubIds = disabledClubs.map((c) => c._id);

    if (organizerId) {
      query.organizerId = { $eq: organizerId, $nin: disabledClubIds };
    } else {
      query.organizerId = { $nin: disabledClubIds };
    }
    let events = await Event.find(query)
      .populate("organizerId", "name email category")
      .sort({ eventStartDate: 1 });

    if (search) {
      const fuse = new Fuse(events, {
        keys: ["name", "organizerId.name", "tags"],
        threshold: 0.4,
        ignoreLocation: true,
      });
      events = fuse.search(search).map((result) => result.item);
    }

    res.json({ events });
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// GET /api/events/my-registrations - Get logged-in user's registrations
router.get(
  "/my-registrations",
  authMiddleware,
  checkRole(["user"]),
  async (req, res) => {
    try {
      const registrations = await Registration.find({ userId: req.user._id })
        .populate({
          path: "eventId",
          populate: { path: "organizerId", select: "name category" },
        })
        .sort({ registrationDate: -1 });
      res.json({ registrations });
    } catch (error) {
      console.error("Error fetching registrations:", error);
      res.status(500).json({ error: "Failed to fetch registrations" });
    }
  },
);

// GET /api/events/organizer/my-events - Get all events by logged-in organizer
router.get(
  "/organizer/my-events",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const events = await Event.find({ organizerId: req.user._id }).sort({
        createdAt: -1,
      });

      res.json({ events });
    } catch (error) {
      console.error("Error fetching organizer events:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  },
);

// GET /api/events/organizer/:id - Get event details for organizer (includes analytics)
router.get(
  "/organizer/:id",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const event = await Event.findById(req.params.id);

      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      // Check if the logged-in club owns this event
      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const approvedRegistrations = await Registration.find({
        eventId: event._id,
        $or: [
          { paymentStatus: "completed", paymentApprovalStatus: "approved" },
          { paymentStatus: "free", paymentApprovalStatus: "not_required" },
        ],
        status: { $nin: ["cancelled", "rejected"] },
      });

      let computedRevenue = 0;
      for (const reg of approvedRegistrations) {
        if (event.eventType === "merchandise" && reg.merchandiseSelection?.variantId) {
          const variant = event.merchandiseDetails?.variants?.find(
            (v) => v.variantId === reg.merchandiseSelection.variantId
          );
          if (variant) {
            computedRevenue += variant.price * (reg.merchandiseSelection.quantity || 1);
          }
        } else if (event.eventType === "normal") {
          computedRevenue += event.registrationFee || 0;
        }
      }

      const confirmedRegistrations = await Registration.countDocuments({
        eventId: event._id,
        status: { $in: ["registered", "attended"] },
      });

      const eventObj = event.toObject();
      eventObj.totalRevenue = computedRevenue;
      eventObj.totalRegistrations = confirmedRegistrations;

      res.json({ event: eventObj });
    } catch (error) {
      console.error("Error fetching event:", error);
      res.status(500).json({ error: "Failed to fetch event" });
    }
  },
);

// GET /api/events/organizer/analytics/summary - Get analytics summary for organizer
router.get(
  "/organizer/analytics/summary",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const events = await Event.find({
        organizerId: req.user._id,
      });

      const eventIds = events.map((e) => e._id);

      // Compute totalRegistrations dynamically (confirmed registrations only)
      const totalRegistrations = await Registration.countDocuments({
        eventId: { $in: eventIds },
        status: { $in: ["registered", "attended"] },
      });

      const approvedRegistrations = await Registration.find({
        eventId: { $in: eventIds },
        $or: [
          { paymentStatus: "completed", paymentApprovalStatus: "approved" },
          { paymentStatus: "free", paymentApprovalStatus: "not_required" },
        ],
        status: { $nin: ["cancelled", "rejected"] },
      });

      // Build a fee lookup from events
      const eventFeeMap = {};
      for (const e of events) {
        if (e.eventType === "merchandise") {
          // fee is per-variant; we'll calculate per registration below
          eventFeeMap[e._id.toString()] = { type: "merchandise", event: e };
        } else {
          eventFeeMap[e._id.toString()] = { type: "normal", fee: e.registrationFee || 0 };
        }
      }

      let totalRevenue = 0;
      for (const reg of approvedRegistrations) {
        const info = eventFeeMap[reg.eventId.toString()];
        if (!info) continue;
        if (info.type === "merchandise" && reg.merchandiseSelection?.variantId) {
          const variant = info.event.merchandiseDetails?.variants?.find(
            (v) => v.variantId === reg.merchandiseSelection.variantId
          );
          if (variant) {
            totalRevenue += variant.price * (reg.merchandiseSelection.quantity || 1);
          }
        } else if (info.type === "normal") {
          totalRevenue += info.fee;
        }
      }

      const summary = {
        totalRegistrations,
        totalRevenue,
        totalAttendance: events.reduce(
          (sum, e) => sum + (e.totalAttendance || 0),
          0,
        ),
        completedEvents: events.filter((e) => e.status === "completed").length,
      };

      res.json({ summary });
    } catch (error) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  },
);

// GET /api/events/organizer/:id/participants - Get participants list for organizer's event
router.get(
  "/organizer/:id/participants",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const event = await Event.findById(req.params.id);

      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      // Check ownership
      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // Fetch all registrations for this event
      const registrations = await Registration.find({ eventId: req.params.id })
        .populate("userId", "firstName lastName email collegeName")
        .sort({ registrationDate: -1 });

      // Format participant data
      const participants = registrations.map((reg) => ({
        _id: reg._id,
        name: `${reg.userId?.firstName || ""} ${reg.userId?.lastName || ""}`.trim(),
        email: reg.userId?.email || "N/A",
        collegeName: reg.userId?.collegeName || "N/A",
        registrationDate: reg.registrationDate,
        paymentStatus: reg.paymentStatus,
        status: reg.status,
        teamName: reg.teamName || "-",
        ticketId: reg.ticketId,
        formData: reg.formData,
        merchandiseSelection: reg.merchandiseSelection,
      }));

      res.json({ participants, count: participants.length });
    } catch (error) {
      console.error("Error fetching participants:", error);
      res.status(500).json({ error: "Failed to fetch participants" });
    }
  },
);

// GET /api/events/:id - Get single event details (public)
router.get("/:id", async (req, res) => {
  try {
    // Populate organizer's 'enabled' status along with other details
    const event = await Event.findById(req.params.id).populate(
      "organizerId",
      "name email category enabled",
    );

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Check if the organizer is disabled
    if (event.organizerId && event.organizerId.enabled === false) {
      return res.status(404).json({ error: "Event not found" });
    }

    if (
      event.status !== "published" &&
      event.status !== "ongoing" &&
      event.status !== "completed"
    ) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json({ event });
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// POST /api/events - Create new event (Club only)
router.post("/", authMiddleware, checkRole(["club"]), async (req, res) => {
  try {
    const {
      name,
      description,
      eventType,
      eligibility,
      registrationDeadline,
      eventStartDate,
      eventEndDate,
      registrationLimit,
      registrationFee,
      tags,
      customForm,
      merchandiseDetails,
    } = req.body;

    // Validation
    if (
      !name ||
      !description ||
      !eventType ||
      !registrationDeadline ||
      !eventStartDate ||
      !eventEndDate
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (eventType === "normal" && !registrationLimit) {
      return res
        .status(400)
        .json({ error: "Registration limit is required for normal events" });
    }

    // Date validation
    const now = new Date();
    const regDeadline = new Date(registrationDeadline);
    const startDate = new Date(eventStartDate);
    const endDate = new Date(eventEndDate);

    if (regDeadline <= now) {
      return res
        .status(400)
        .json({ error: "Registration deadline must be in the future" });
    }

    if (startDate <= regDeadline) {
      return res.status(400).json({
        error: "Event start date must be after registration deadline",
      });
    }

    if (endDate <= startDate) {
      return res
        .status(400)
        .json({ error: "Event end date must be after start date" });
    }

    // Validate merchandise events
    if (eventType === "merchandise") {
      if (
        !merchandiseDetails ||
        !merchandiseDetails.variants ||
        merchandiseDetails.variants.length === 0
      ) {
        return res
          .status(400)
          .json({ error: "Merchandise events must have at least one variant" });
      }
    }

    const event = new Event({
      name,
      description,
      organizerId: req.user._id,
      eventType,
      eligibility: eligibility || "all",
      registrationDeadline,
      eventStartDate,
      eventEndDate,
      registrationLimit,
      registrationFee: eventType === "merchandise" ? 0 : registrationFee || 0,
      tags: tags || [],
      customForm: customForm || { fields: [], locked: false },
      merchandiseDetails:
        eventType === "merchandise" ? merchandiseDetails : undefined,
      status: "draft",
    });

    await event.save();

    res.status(201).json({
      message: "Event created successfully",
      event,
    });
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: error.message || "Failed to create event" });
  }
});

// PATCH /api/events/:id - Update event
router.patch("/:id", authMiddleware, checkRole(["club"]), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Check ownership
    if (event.organizerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    const {
      name,
      description,
      eligibility,
      registrationDeadline,
      eventStartDate,
      eventEndDate,
      registrationLimit,
      registrationFee,
      tags,
      customForm,
      merchandiseDetails,
      status,
    } = req.body;

    // Editing rules based on status
    if (event.status === "draft") {
      // Draft: free edits
      const oldStatus = event.status;
      if (name) event.name = name;
      if (description) event.description = description;
      if (eligibility) event.eligibility = eligibility;
      if (registrationDeadline)
        event.registrationDeadline = registrationDeadline;
      if (eventStartDate) event.eventStartDate = eventStartDate;
      if (eventEndDate) event.eventEndDate = eventEndDate;
      if (registrationLimit) event.registrationLimit = registrationLimit;
      if (registrationFee !== undefined)
        event.registrationFee =
          event.eventType === "merchandise" ? 0 : registrationFee;
      if (tags) event.tags = tags;
      if (customForm) event.customForm = customForm;
      if (merchandiseDetails) event.merchandiseDetails = merchandiseDetails;
      if (status) event.status = status;

      // Send Discord notification when publishing
      if (oldStatus === "draft" && status === "published") {
        const club = await Club.findById(event.organizerId);
        if (club) {
          await sendDiscordNotification(club, event);
        }
      }
    } else if (event.status === "published") {
      // Published: limited edits
      if (description) event.description = description;

      // Can extend deadline
      if (registrationDeadline) {
        const newDeadline = new Date(registrationDeadline);
        const currentDeadline = new Date(event.registrationDeadline);
        if (newDeadline > currentDeadline) {
          event.registrationDeadline = registrationDeadline;
        } else {
          return res.status(400).json({
            error: "Can only extend registration deadline, not reduce it",
          });
        }
      }

      // Can increase limit
      if (registrationLimit) {
        if (registrationLimit >= event.registrationLimit) {
          event.registrationLimit = registrationLimit;
        } else {
          return res.status(400).json({
            error: "Can only increase registration limit, not reduce it",
          });
        }
      }

      // Can complete event directly
      if (status === "completed") {
        event.status = "completed";
        // Mark all non-scanned participants as absent
        await Registration.updateMany(
          { eventId: event._id, attendanceStatus: "not_checked" },
          {
            attendanceStatus: "absent",
            attendanceTimestamp: new Date(),
          },
        );
      }

      // Can mark as ongoing if start date has passed
      if (status === "ongoing") {
        event.status = "ongoing";
      }
    } else if (event.status === "ongoing" || event.status === "completed") {
      // Ongoing/Completed: only status changes
      if (status === "completed") {
        event.status = status;
        // Mark all non-scanned participants as absent when completing
        await Registration.updateMany(
          { eventId: event._id, attendanceStatus: "not_checked" },
          {
            attendanceStatus: "absent",
            attendanceTimestamp: new Date(),
          },
        );
      } else {
        return res.status(400).json({
          error: "Cannot edit ongoing/completed events except status",
        });
      }
    }

    await event.save();

    res.json({
      message: "Event updated successfully",
      event,
    });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ error: error.message || "Failed to update event" });
  }
});

// DELETE /api/events/:id - Delete event (only drafts)
router.delete("/:id", authMiddleware, checkRole(["club"]), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Check ownership
    if (event.organizerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    // Only allow deleting drafts
    if (event.status !== "draft") {
      return res.status(400).json({ error: "Can only delete draft events" });
    }

    await Promise.all([
      Registration.deleteMany({ eventId: req.params.id }),
      Feedback.deleteMany({ eventId: req.params.id }),
      Discussion.deleteMany({ eventId: req.params.id }),
    ]);

    await Event.findByIdAndDelete(req.params.id);

    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

// POST /api/events/:id/register - Register for event
router.post(
  "/:id/register",
  authMiddleware,
  checkRole(["user"]),
  formFileUpload.any(),
  async (req, res) => {
    try {
      const eventId = req.params.id;
      const userId = req.user._id;

      let { formData, merchandiseSelection, teamName } = req.body;

      // Handle file uploads if any
      if (req.files && req.files.length > 0) {
        if (typeof formData === "string") {
          try {
            formData = JSON.parse(formData);
          } catch (e) {
            formData = {};
          }
        }
        if (Array.isArray(formData)) {
          req.files.forEach(file => {
            const fieldIndex = formData.findIndex(f => f.fieldId === file.fieldname);
            if (fieldIndex !== -1) {
              formData[fieldIndex].value = file.filename;
            } else {
              formData.push({ fieldId: file.fieldname, value: file.filename });
            }
          });
        } else if (formData && typeof formData === 'object') {
          req.files.forEach(file => {
            formData[file.fieldname] = file.filename;
          });
        }
      }

      if (typeof merchandiseSelection === "string") {
        try { merchandiseSelection = JSON.parse(merchandiseSelection); } catch (e) { }
      }


      const event = await Event.findById(eventId);
      if (!event) return res.status(404).json({ error: "Event not found" });

      if (event.status !== "published" && event.status !== "ongoing") {
        return res
          .status(400)
          .json({ error: "Event is not open for registration" });
      }

      if (new Date() > new Date(event.registrationDeadline)) {
        return res
          .status(400)
          .json({ error: "Registration deadline has passed" });
      }

      // Eligibility Check
      if (event.eligibility === "iiitans" && !req.user.isIIITian) {
        return res
          .status(403)
          .json({ error: "This event is restricted to IIITians only" });
      }
      if (event.eligibility === "external" && req.user.isIIITian) {
        return res
          .status(403)
          .json({ error: "This event is restricted to external participants only" });
      }

      if (event.totalRegistrations >= event.registrationLimit) {
        return res.status(400).json({ error: "Registration limit reached" });
      }

      // Check already registered
      const existing = await Registration.findOne({ userId, eventId });
      if (existing) {
        return res
          .status(409)
          .json({ error: "Already registered for this event" });
      }

      // Merchandise specific checks
      let variant = null;
      if (event.eventType === "merchandise") {
        if (!merchandiseSelection || !merchandiseSelection.variantId) {
          return res.status(400).json({ error: "Please select a variant" });
        }
        // Check stock
        variant = event.merchandiseDetails.variants.find(
          (v) => v.variantId === merchandiseSelection.variantId,
        );
        if (!variant) return res.status(400).json({ error: "Invalid variant" });
        if (variant.stockQuantity < (merchandiseSelection.quantity || 1)) {
          return res.status(400).json({ error: "Out of stock" });
        }
      }

      // Determine payment status and approval workflow
      let paymentStatus = "free";
      let paymentApprovalStatus = "not_required";
      let registrationApprovalStatus = "not_required";
      let registrationStatus = "registered";

      // For any paid event (merchandise with price OR normal event with registration fee)
      const isPaidEvent =
        (event.eventType === "merchandise" && variant && variant.price > 0) ||
        (event.eventType === "normal" && event.registrationFee > 0);

      if (isPaidEvent) {
        paymentStatus = "pending";
        paymentApprovalStatus = "pending"; // Requires payment proof upload and approval
        registrationStatus = "pending_approval"; // All paid events require payment approval
      }
      if (event.requiresApproval) {
        registrationApprovalStatus = "pending";
        if (!isPaidEvent) {
          // Only set pending_approval if not already set by payment requirement
          registrationStatus = "pending_approval";
        }
      }
      let ticketId = null;
      if (!isPaidEvent && registrationApprovalStatus === "not_required") {
        ticketId = uuidv4();
      }

      const registration = new Registration({
        userId,
        eventId,
        ticketId,
        status: registrationStatus,
        paymentStatus,
        paymentApprovalStatus,
        registrationApprovalStatus,
        formData: event.eventType === "normal" ? formData : undefined,
        merchandiseSelection:
          event.eventType === "merchandise" ? merchandiseSelection : undefined,
        teamName,
        attendanceStatus: "not_checked",
      });

      await registration.save();
      if (
        paymentApprovalStatus === "not_required" &&
        registrationApprovalStatus === "not_required"
      ) {
        // Generate encrypted QR code
        const { qrCodeBuffer, encryptedData, iv } =
          await generateEncryptedQRCode({
            ticketId,
            userId: userId.toString(),
            eventId: eventId.toString(),
            eventName: event.name,
            userName: `${req.user.firstName} ${req.user.lastName}`,
            registrationDate: registration.registrationDate,
          });

        // Save encrypted QR data to registration
        registration.qrCodeEncrypted = encryptedData;
        registration.qrCodeIV = iv;
        await registration.save();

        // Send registration confirmation email with QR code
        try {
          await sendRegistrationEmail({
            to: req.user.email,
            userName: `${req.user.firstName} ${req.user.lastName}`,
            eventName: event.name,
            eventDate: event.eventStartDate,
            eventLocation: event.location,
            ticketId,
            qrCodeBuffer,
            registrationFee: event.registrationFee || 0,
          });
          console.log(`Registration email sent to ${req.user.email}`);
        } catch (emailError) {
          console.error("Failed to send registration email:", emailError);
          // Don't fail the registration if email fails
        }
      }
      if (
        paymentApprovalStatus === "not_required" &&
        registrationApprovalStatus === "not_required"
      ) {
        event.totalRegistrations += 1;
        // For free merchandise, decrement stock immediately
        if (event.eventType === "merchandise" && variant) {
          variant.stockQuantity -= merchandiseSelection.quantity || 1;
        }
        await event.save();
      }

      // For paid events requiring approval
      if (paymentApprovalStatus === "pending") {
        // Payment is pending
      }

      // For events requiring manual approval
      if (registrationApprovalStatus === "pending") {
        // Registration approval is pending
      }

      // Response message
      const requiresPaymentProof = paymentApprovalStatus === "pending";
      const requiresApproval = registrationApprovalStatus === "pending";

      let message = "Registration successful!";
      if (requiresApproval && requiresPaymentProof) {
        message =
          "Registration received! Awaiting organizer approval and payment verification.";
      } else if (requiresApproval) {
        message = "Registration received! Awaiting organizer approval.";
      } else if (requiresPaymentProof) {
        message = "Registration received! Please upload payment proof.";
      }

      res.status(201).json({
        message,
        ticketId,
        requiresPaymentProof,
        requiresApproval,
        registrationId: registration._id,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: error.message || "Registration failed" });
    }
  },
);

// POST /api/events/:id/upload-payment-proof - Upload payment proof image
router.post(
  "/:id/upload-payment-proof",
  authMiddleware,
  checkRole(["user"]),
  paymentProofUpload.single("paymentProof"),
  async (req, res) => {
    try {
      const eventId = req.params.id;
      const userId = req.user._id;

      if (!req.file) {
        return res
          .status(400)
          .json({ error: "Payment proof image is required" });
      }

      const registration = await Registration.findOne({ userId, eventId });
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      if (registration.paymentApprovalStatus !== "pending") {
        return res
          .status(400)
          .json({ error: "Payment proof not required or already submitted" });
      }

      // Save the file path
      registration.paymentProofImage = `/uploads/payment-proofs/${req.file.filename}`;
      await registration.save();

      res.json({
        message: "Payment proof uploaded successfully. Awaiting approval.",
        imagePath: registration.paymentProofImage,
      });
    } catch (error) {
      console.error("Payment proof upload error:", error);
      res.status(500).json({ error: "Failed to upload payment proof" });
    }
  },
);

// GET /api/events/:id/pending-payments - Get pending payment approvals (Organizer only)
router.get(
  "/:id/pending-payments",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const event = await Event.findById(req.params.id);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const pendingPayments = await Registration.find({
        eventId: req.params.id,
        paymentApprovalStatus: { $in: ["pending"] },
      })
        .populate("userId", "firstName lastName email collegeName")
        .sort({ createdAt: -1 });

      // Also get recently processed for reference
      const recentlyProcessed = await Registration.find({
        eventId: req.params.id,
        paymentApprovalStatus: { $in: ["approved", "rejected"] },
      })
        .populate("userId", "firstName lastName email")
        .sort({ paymentApprovalDate: -1 })
        .limit(20);

      res.json({
        pending: pendingPayments.map((p) => ({
          _id: p._id,
          ticketId: p.ticketId,
          user: p.userId,
          merchandiseSelection: p.merchandiseSelection,
          paymentProofImage: p.paymentProofImage,
          createdAt: p.createdAt,
        })),
        recentlyProcessed: recentlyProcessed.map((p) => ({
          _id: p._id,
          ticketId: p.ticketId,
          user: p.userId,
          status: p.paymentApprovalStatus,
          processedAt: p.paymentApprovalDate,
          rejectionReason: p.paymentRejectionReason,
        })),
      });
    } catch (error) {
      console.error("Error fetching pending payments:", error);
      res.status(500).json({ error: "Failed to fetch pending payments" });
    }
  },
);

// POST /api/events/:eventId/approve-payment/:registrationId - Approve payment
router.post(
  "/:eventId/approve-payment/:registrationId",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { eventId, registrationId } = req.params;

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const registration = await Registration.findById(registrationId);
      if (!registration || registration.eventId.toString() !== eventId) {
        return res.status(404).json({ error: "Registration not found" });
      }

      if (registration.paymentApprovalStatus !== "pending") {
        return res.status(400).json({ error: "Payment already processed" });
      }

      if (!registration.paymentProofImage) {
        return res.status(400).json({ error: "No payment proof uploaded yet" });
      }

      // Approve the payment
      registration.paymentApprovalStatus = "approved";
      registration.paymentApprovalDate = new Date();
      registration.paymentApprovedBy = req.user._id;
      registration.paymentStatus = "completed";

      // Delete the payment proof image
      if (registration.paymentProofImage) {
        const filePath = path.join(
          __dirname,
          "..",
          registration.paymentProofImage,
        );
        fs.unlink(filePath, (err) => {
          if (err) console.error("Failed to delete payment proof:", err);
        });
        registration.paymentProofImage = null;
      }

      if (registration.registrationApprovalStatus !== "pending") {
        registration.status = "registered";
      }

      // Generate ticket ID now for paid events (if not already generated)
      if (!registration.ticketId) {
        registration.ticketId = uuidv4();
      }

      // Populate user data for email
      await registration.populate("userId", "firstName lastName email");

      // Generate encrypted QR code now that payment is approved
      const { qrCodeBuffer, encryptedData, iv } = await generateEncryptedQRCode(
        {
          ticketId: registration.ticketId,
          userId: registration.userId._id.toString(),
          eventId: eventId.toString(),
          eventName: event.name,
          userName: `${registration.userId.firstName} ${registration.userId.lastName}`,
          registrationDate: registration.registrationDate,
        },
      );

      // Save encrypted QR data to registration
      registration.qrCodeEncrypted = encryptedData;
      registration.qrCodeIV = iv;
      await registration.save();

      // Calculate the amount paid
      let paidAmount = event.registrationFee || 0;
      if (
        registration.merchandiseSelection &&
        registration.merchandiseSelection.variantId
      ) {
        const variant = event.merchandiseDetails.variants.find(
          (v) => v.variantId === registration.merchandiseSelection.variantId,
        );
        if (variant) {
          paidAmount =
            variant.price * (registration.merchandiseSelection.quantity || 1);
        }
      }

      // Send confirmation email with QR code
      try {
        await sendRegistrationEmail({
          to: registration.userId.email,
          userName: `${registration.userId.firstName} ${registration.userId.lastName}`,
          eventName: event.name,
          eventDate: event.eventStartDate,
          eventLocation: event.location,
          ticketId: registration.ticketId,
          qrCodeBuffer,
          registrationFee: paidAmount,
        });
        console.log(
          `Payment approved confirmation email sent to ${registration.userId.email}`,
        );
      } catch (emailError) {
        console.error("Failed to send payment approval email:", emailError);
      }

      // Now decrement stock and update event stats
      if (
        registration.merchandiseSelection &&
        registration.merchandiseSelection.variantId
      ) {
        const variant = event.merchandiseDetails.variants.find(
          (v) => v.variantId === registration.merchandiseSelection.variantId,
        );
        if (variant) {
          variant.stockQuantity -=
            registration.merchandiseSelection.quantity || 1;
        }
      }
      event.totalRegistrations += 1;
      await event.save();

      res.json({
        message: "Payment approved successfully",
        registration: {
          _id: registration._id,
          ticketId: registration.ticketId,
          status: registration.paymentApprovalStatus,
        },
      });
    } catch (error) {
      console.error("Payment approval error:", error);
      res.status(500).json({ error: "Failed to approve payment" });
    }
  },
);

// POST /api/events/:eventId/reject-payment/:registrationId - Reject payment
router.post(
  "/:eventId/reject-payment/:registrationId",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { eventId, registrationId } = req.params;
      const { reason } = req.body;

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const registration = await Registration.findById(registrationId);
      if (!registration || registration.eventId.toString() !== eventId) {
        return res.status(404).json({ error: "Registration not found" });
      }

      if (registration.paymentApprovalStatus !== "pending") {
        return res.status(400).json({ error: "Payment already processed" });
      }

      // Reject the payment
      registration.paymentApprovalStatus = "rejected";
      registration.paymentApprovalDate = new Date();
      registration.paymentApprovedBy = req.user._id;
      registration.paymentRejectionReason =
        reason || "Payment rejected by organizer";

      // Delete the payment proof image
      if (registration.paymentProofImage) {
        const filePath = path.join(
          __dirname,
          "..",
          registration.paymentProofImage,
        );
        fs.unlink(filePath, (err) => {
          if (err) console.error("Failed to delete payment proof:", err);
        });
        registration.paymentProofImage = null;
      }

      await registration.save();

      res.json({
        message: "Payment rejected",
        registration: {
          _id: registration._id,
          ticketId: registration.ticketId,
          status: registration.paymentApprovalStatus,
        },
      });
    } catch (error) {
      console.error("Payment rejection error:", error);
      res.status(500).json({ error: "Failed to reject payment" });
    }
  },
);

// GET /api/events/:id/pending-registrations - Get pending registration approvals (Organizer only)
router.get(
  "/:id/pending-registrations",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const event = await Event.findById(req.params.id);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const pendingRegistrations = await Registration.find({
        eventId: req.params.id,
        registrationApprovalStatus: "pending",
      })
        .populate(
          "userId",
          "firstName lastName email collegeName contactNumber",
        )
        .sort({ createdAt: -1 });

      // Also get recently processed for reference
      const recentlyProcessed = await Registration.find({
        eventId: req.params.id,
        registrationApprovalStatus: { $in: ["approved", "rejected"] },
      })
        .populate("userId", "firstName lastName email")
        .sort({ registrationApprovalDate: -1 })
        .limit(20);

      res.json({
        pending: pendingRegistrations.map((r) => ({
          _id: r._id,
          ticketId: r.ticketId,
          user: r.userId,
          formData: r.formData,
          merchandiseSelection: r.merchandiseSelection,
          teamName: r.teamName,
          paymentStatus: r.paymentStatus,
          createdAt: r.createdAt,
        })),
        recentlyProcessed: recentlyProcessed.map((r) => ({
          _id: r._id,
          ticketId: r.ticketId,
          user: r.userId,
          status: r.registrationApprovalStatus,
          processedAt: r.registrationApprovalDate,
          rejectionReason: r.registrationRejectionReason,
        })),
      });
    } catch (error) {
      console.error("Error fetching pending registrations:", error);
      res.status(500).json({ error: "Failed to fetch pending registrations" });
    }
  },
);

// POST /api/events/:eventId/approve-registration/:registrationId - Approve registration
router.post(
  "/:eventId/approve-registration/:registrationId",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { eventId, registrationId } = req.params;

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const registration = await Registration.findById(registrationId);
      if (!registration || registration.eventId.toString() !== eventId) {
        return res.status(404).json({ error: "Registration not found" });
      }

      if (registration.registrationApprovalStatus !== "pending") {
        return res
          .status(400)
          .json({ error: "Registration already processed" });
      }

      // Approve the registration
      registration.registrationApprovalStatus = "approved";
      registration.status = "registered";
      registration.registrationApprovalDate = new Date();
      registration.registrationApprovedBy = req.user._id;

      if (!registration.ticketId) {
        registration.ticketId = uuidv4();
      }

      // Populate user data for email
      await registration.populate("userId", "firstName lastName email");
      if (
        registration.paymentApprovalStatus !== "pending" &&
        !registration.qrCodeEncrypted
      ) {
        // Generate encrypted QR code now that registration is approved
        const { qrCodeBuffer, encryptedData, iv } =
          await generateEncryptedQRCode({
            ticketId: registration.ticketId,
            userId: registration.userId._id.toString(),
            eventId: eventId.toString(),
            eventName: event.name,
            userName: `${registration.userId.firstName} ${registration.userId.lastName}`,
            registrationDate: registration.registrationDate,
          });

        // Save encrypted QR data to registration
        registration.qrCodeEncrypted = encryptedData;
        registration.qrCodeIV = iv;
        await registration.save();

        // Send confirmation email with QR code
        try {
          await sendRegistrationEmail({
            to: registration.userId.email,
            userName: `${registration.userId.firstName} ${registration.userId.lastName}`,
            eventName: event.name,
            eventDate: event.eventStartDate,
            eventLocation: event.location,
            ticketId: registration.ticketId,
            qrCodeBuffer,
            registrationFee: event.registrationFee || 0,
          });
          console.log(
            `Registration approved email sent to ${registration.userId.email}`,
          );
        } catch (emailError) {
          console.error(
            "Failed to send registration approval email:",
            emailError,
          );
        }

        // Update event stats if payment is not required
        if (registration.paymentApprovalStatus === "not_required") {
          event.totalRegistrations += 1;
          await event.save();
        }
      } else {
        await registration.save();
      }

      res.json({
        message: "Registration approved successfully",
        registration: {
          _id: registration._id,
          ticketId: registration.ticketId,
          status: registration.registrationApprovalStatus,
        },
      });
    } catch (error) {
      console.error("Registration approval error:", error);
      res.status(500).json({ error: "Failed to approve registration" });
    }
  },
);

// POST /api/events/:eventId/reject-registration/:registrationId - Reject registration
router.post(
  "/:eventId/reject-registration/:registrationId",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { eventId, registrationId } = req.params;
      const { reason } = req.body;

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const registration = await Registration.findById(registrationId);
      if (!registration || registration.eventId.toString() !== eventId) {
        return res.status(404).json({ error: "Registration not found" });
      }

      if (registration.registrationApprovalStatus !== "pending") {
        return res
          .status(400)
          .json({ error: "Registration already processed" });
      }

      // Reject the registration
      registration.registrationApprovalStatus = "rejected";
      registration.status = "rejected";
      registration.registrationApprovalDate = new Date();
      registration.registrationApprovedBy = req.user._id;
      registration.registrationRejectionReason =
        reason || "Registration rejected by organizer";
      await registration.save();

      res.json({
        message: "Registration rejected",
        registration: {
          _id: registration._id,
          ticketId: registration.ticketId,
          status: registration.registrationApprovalStatus,
        },
      });
    } catch (error) {
      console.error("Registration rejection error:", error);
      res.status(500).json({ error: "Failed to reject registration" });
    }
  },
);

// GET /api/events/:eventId/ticket/:registrationId/qr - Generate QR code for ticket
router.get(
  "/:eventId/ticket/:registrationId/qr",
  authMiddleware,
  async (req, res) => {
    try {
      const { eventId, registrationId } = req.params;

      const registration = await Registration.findById(registrationId)
        .populate("userId", "firstName lastName email")
        .populate("eventId", "name eventStartDate");

      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      // Only allow ticket owner or organizer to access
      const event = await Event.findById(eventId);
      const isOwner =
        registration.userId._id.toString() === req.user._id?.toString();
      const isOrganizer =
        event?.organizerId.toString() === req.user._id?.toString();

      if (!isOwner && !isOrganizer) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // Check if payment is approved for merchandise events
      if (registration.paymentApprovalStatus === "pending") {
        return res
          .status(400)
          .json({ error: "QR not available - payment pending approval" });
      }
      if (registration.paymentApprovalStatus === "rejected") {
        return res
          .status(400)
          .json({ error: "QR not available - payment was rejected" });
      }

      // Generate QR code data
      const qrData = JSON.stringify({
        ticketId: registration.ticketId,
        eventId: eventId,
        registrationId: registrationId,
        userId: registration.userId._id,
        timestamp: Date.now(),
      });

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
        width: 300,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });

      res.json({
        qrCode: qrCodeDataUrl,
        ticketInfo: {
          ticketId: registration.ticketId,
          eventName: registration.eventId.name,
          participantName: `${registration.userId.firstName} ${registration.userId.lastName}`,
          eventDate: registration.eventId.eventStartDate,
        },
      });
    } catch (error) {
      console.error("QR generation error:", error);
      res.status(500).json({ error: "Failed to generate QR code" });
    }
  },
);

// POST /api/events/:eventId/scan-ticket - Scan QR and mark attendance
router.post(
  "/:eventId/scan-ticket",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { eventId } = req.params;
      const { ticketId, qrData } = req.body;

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // Check if event is ongoing
      if (event.status !== "ongoing") {
        return res.status(400).json({
          error: `Cannot mark attendance - Event is ${event.status}. Event must be marked as "ongoing" to scan tickets.`,
          currentStatus: event.status,
        });
      }

      // Parse QR data if provided
      let parsedQR = null;
      let decryptedTicketId = null;
      const normalizeTicketId = (value) =>
        typeof value === "string" ? value.trim() : "";

      if (qrData) {
        try {
          const qrPayload = typeof qrData === "string" ? qrData.trim() : qrData;

          if (typeof qrPayload === "object" && qrPayload !== null) {
            parsedQR = qrPayload;
          } else if (typeof qrPayload === "string" && qrPayload.length > 0) {
            try {
              parsedQR = JSON.parse(qrPayload);
            } catch {
              // Support plain-text QR payloads where ticket ID itself is encoded.
              decryptedTicketId = qrPayload;
            }
          }

          if (parsedQR) {
            // Check if it's our encrypted format
            if (parsedQR.data && parsedQR.iv) {
              const decryptedString = decryptQRData(parsedQR.data, parsedQR.iv);
              const decryptedJson = JSON.parse(decryptedString);
              decryptedTicketId = decryptedJson.ticketId;
            } else if (parsedQR.ticketId) {
              // Unencrypted fallback (old tickets or legacy)
              decryptedTicketId = parsedQR.ticketId;
            } else if (parsedQR.ticket && parsedQR.ticket.id) {
              decryptedTicketId = parsedQR.ticket.id;
            }
          }
        } catch (e) {
          console.error("QR Decryption error:", e);
          return res
            .status(400)
            .json({ error: "Invalid or corrupted QR code" });
        }
      }

      const searchTicketId =
        normalizeTicketId(ticketId) || normalizeTicketId(decryptedTicketId);
      if (!searchTicketId) {
        return res.status(400).json({ error: "Ticket ID is required" });
      }

      const registration = await Registration.findOne({
        ticketId: searchTicketId,
        eventId: eventId,
      }).populate("userId", "firstName lastName email collegeName");

      if (!registration) {
        return res
          .status(404)
          .json({ error: "Ticket not found for this event" });
      }

      // Check if registration status is valid for attendance
      if (registration.status === "cancelled") {
        return res.status(400).json({
          error: "Cannot mark attendance - registration is cancelled",
        });
      }
      if (registration.status === "rejected") {
        return res.status(400).json({
          error: "Cannot mark attendance - registration was rejected",
        });
      }
      if (registration.status === "pending_approval") {
        return res.status(400).json({
          error: "Cannot mark attendance - registration approval pending",
        });
      }
      if (
        registration.status !== "registered" &&
        registration.status !== "attended"
      ) {
        return res.status(400).json({
          error: `Cannot mark attendance - invalid registration status: ${registration.status}`,
        });
      }

      // Check if registration approval is complete
      if (registration.registrationApprovalStatus === "pending") {
        return res.status(400).json({
          error: "Cannot mark attendance - registration approval pending",
        });
      }
      if (registration.registrationApprovalStatus === "rejected") {
        return res.status(400).json({
          error: "Cannot mark attendance - registration was rejected",
        });
      }

      // Check if payment is approved for paid events
      if (registration.paymentApprovalStatus === "pending") {
        return res
          .status(400)
          .json({ error: "Cannot mark attendance - payment approval pending" });
      }
      if (registration.paymentApprovalStatus === "rejected") {
        return res
          .status(400)
          .json({ error: "Cannot mark attendance - payment was rejected" });
      }

      // Check for duplicate scan
      if (registration.attendanceStatus === "present") {
        // Log the duplicate scan attempt
        registration.scanHistory.push({
          timestamp: new Date(),
          action: "duplicate_rejected",
          performedBy: req.user._id,
          notes: "Duplicate scan attempt rejected",
        });
        await registration.save();

        return res.status(409).json({
          error: "Duplicate scan - Attendance already marked",
          alreadyMarkedAt: registration.attendanceTimestamp,
          participant: {
            name: `${registration.userId.firstName} ${registration.userId.lastName}`,
            email: registration.userId.email,
          },
        });
      }

      // Mark attendance
      registration.attendanceStatus = "present";
      registration.attendanceTimestamp = new Date();
      registration.attendanceMarkedBy = req.user._id;
      registration.status = "attended";

      // Add to scan history
      registration.scanHistory.push({
        timestamp: new Date(),
        action: "scanned",
        performedBy: req.user._id,
      });

      await registration.save();

      // Update event attendance stats
      event.totalAttendance += 1;
      await event.save();

      res.json({
        success: true,
        message: "Attendance marked successfully",
        participant: {
          name: `${registration.userId.firstName} ${registration.userId.lastName}`,
          email: registration.userId.email,
          collegeName: registration.userId.collegeName,
          ticketId: registration.ticketId,
          markedAt: registration.attendanceTimestamp,
        },
      });
    } catch (error) {
      console.error("Ticket scan error:", error);
      res.status(500).json({ error: "Failed to process ticket scan" });
    }
  },
);

// POST /api/events/:eventId/manual-attendance/:registrationId - Manual attendance override
router.post(
  "/:eventId/manual-attendance/:registrationId",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { eventId, registrationId } = req.params;
      const { status, reason } = req.body;

      if (!["present", "absent"].includes(status)) {
        return res
          .status(400)
          .json({ error: "Status must be 'present' or 'absent'" });
      }

      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({
          error: "Reason is required for manual override (min 5 characters)",
        });
      }

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const registration = await Registration.findById(registrationId).populate(
        "userId",
        "firstName lastName email",
      );

      if (!registration || registration.eventId.toString() !== eventId) {
        return res.status(404).json({ error: "Registration not found" });
      }

      const previousStatus = registration.attendanceStatus;

      // Apply manual override
      registration.attendanceStatus = status;
      registration.attendanceTimestamp = new Date();
      registration.attendanceMarkedBy = req.user._id;
      registration.manualOverride = true;
      registration.overrideReason = reason;
      registration.status = status === "present" ? "attended" : "registered";

      // Add to audit log
      registration.scanHistory.push({
        timestamp: new Date(),
        action: status === "present" ? "manual_present" : "manual_absent",
        performedBy: req.user._id,
        notes: reason,
      });

      await registration.save();

      // Update event attendance stats
      if (previousStatus !== "present" && status === "present") {
        event.totalAttendance += 1;
      } else if (previousStatus === "present" && status === "absent") {
        event.totalAttendance = Math.max(0, event.totalAttendance - 1);
      }
      await event.save();

      res.json({
        message: `Attendance manually set to ${status}`,
        participant: {
          name: `${registration.userId.firstName} ${registration.userId.lastName}`,
          email: registration.userId.email,
          status: registration.attendanceStatus,
          manualOverride: true,
          reason: reason,
        },
      });
    } catch (error) {
      console.error("Manual attendance error:", error);
      res.status(500).json({ error: "Failed to update attendance" });
    }
  },
);

// GET /api/events/:id/attendance-dashboard - Live attendance stats
router.get(
  "/:id/attendance-dashboard",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const event = await Event.findById(req.params.id);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // Get all registrations with valid payment status
      const registrations = await Registration.find({
        eventId: req.params.id,
        $or: [
          { paymentApprovalStatus: "not_required" },
          { paymentApprovalStatus: "approved" },
        ],
      }).populate("userId", "firstName lastName email collegeName");

      const present = registrations.filter(
        (r) => r.attendanceStatus === "present",
      );
      const notChecked = registrations.filter(
        (r) => r.attendanceStatus === "not_checked",
      );
      const absent = registrations.filter(
        (r) => r.attendanceStatus === "absent",
      );

      res.json({
        stats: {
          totalRegistered: registrations.length,
          present: present.length,
          notYetScanned: notChecked.length,
          absent: absent.length,
          attendanceRate:
            registrations.length > 0
              ? ((present.length / registrations.length) * 100).toFixed(1)
              : 0,
        },
        participants: registrations.map((r) => ({
          _id: r._id,
          name: `${r.userId?.firstName || ""} ${r.userId?.lastName || ""}`.trim(),
          email: r.userId?.email,
          collegeName: r.userId?.collegeName,
          ticketId: r.ticketId,
          attendanceStatus: r.attendanceStatus,
          attendanceTimestamp: r.attendanceTimestamp,
          manualOverride: r.manualOverride,
          overrideReason: r.overrideReason,
        })),
      });
    } catch (error) {
      console.error("Attendance dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch attendance data" });
    }
  },
);

// GET /api/events/:id/export-attendance - Export attendance as CSV
router.get(
  "/:id/export-attendance",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const event = await Event.findById(req.params.id);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const registrations = await Registration.find({
        eventId: req.params.id,
        $or: [
          { paymentApprovalStatus: "not_required" },
          { paymentApprovalStatus: "approved" },
        ],
      }).populate("userId", "firstName lastName email collegeName");

      // Generate CSV
      const headers = [
        "Name",
        "Email",
        "College",
        "Ticket ID",
        "Attendance Status",
        "Check-in Time",
        "Manual Override",
        "Override Reason",
      ];
      const rows = registrations.map((r) => [
        `${r.userId?.firstName || ""} ${r.userId?.lastName || ""}`.trim(),
        r.userId?.email || "N/A",
        r.userId?.collegeName || "N/A",
        r.ticketId,
        r.attendanceStatus,
        r.attendanceTimestamp
          ? new Date(r.attendanceTimestamp).toLocaleString()
          : "N/A",
        r.manualOverride ? "Yes" : "No",
        r.overrideReason || "",
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${event.name}_attendance.csv"`,
      );
      res.send(csvContent);
    } catch (error) {
      console.error("Attendance export error:", error);
      res.status(500).json({ error: "Failed to export attendance" });
    }
  },
);

module.exports = router;
