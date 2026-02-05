const express = require("express");
const router = express.Router();
const Event = require("../models/event");
const Registration = require("../models/registration");
const Club = require("../models/club");
const authMiddleware = require("../middleware/authMiddleware");
const checkRole = require("../middleware/checkRole");
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const QRCode = require('qrcode');
const { generateEncryptedQRCode, sendRegistrationEmail } = require('../utils/emailService');
const paymentProofUpload = require('../middleware/uploadMiddleware');

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
      embeds: [{
        title: `🎉 New Event: ${event.name}`,
        description: event.description,
        color: 0x5865F2,
        fields: [
          {
            name: "📅 Event Date",
            value: new Date(event.eventStartDate).toLocaleDateString(),
            inline: true
          },
          {
            name: "🎫 Registration Fee",
            value: event.registrationFee > 0 ? `₹${event.registrationFee}` : "Free",
            inline: true
          },
          {
            name: "👥 Spots Available",
            value: `${event.registrationLimit}`,
            inline: true
          },
          {
            name: "⏰ Registration Deadline",
            value: new Date(event.registrationDeadline).toLocaleString(),
            inline: false
          }
        ],
        footer: {
          text: `Event Type: ${event.eventType} | Eligibility: ${event.eligibility}`
        },
        timestamp: new Date().toISOString()
      }]
    });
  } catch (error) {
    console.error('Discord webhook error:', error.message);
  }
}

// GET /api/events - Get all published events (public) with filters
router.get("/", async (req, res) => {
  try {
    const { search, type, eligibility, startDate, endDate, organizerId, status } = req.query;

    // Default status to published/ongoing if not specified
    const query = {};
    if (status) {
      query.status = { $in: status.split(',') };
      // detailed security check: if fetching drafts, ensure ownership? 
      // For public API, we might want to restrict drafts.
      // But "completed" or "closed" are fine for public history.
      // Let's filter out drafts unless specific conditions (which we won't handle here for simplicity, organizer has separate route)
      if (query.status.$in.includes('draft')) {
        query.status.$in = query.status.$in.filter(s => s !== 'draft');
      }
    } else {
      query.status = { $in: ["published", "ongoing"] };
    }

    if (type) query.eventType = type;
    if (eligibility) query.eligibility = eligibility;

    if (startDate || endDate) {
      query.eventStartDate = {};
      if (startDate) query.eventStartDate.$gte = new Date(startDate);
      if (endDate) query.eventStartDate.$lte = new Date(endDate);
    }

    if (organizerId) query.organizerId = organizerId;

    if (search) {
      // Search event name OR organizer name.
      const Club = require('../models/club');
      const clubs = await Club.find({ name: { $regex: search, $options: 'i' } });
      const clubIds = clubs.map(c => c._id);

      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { organizerId: { $in: clubIds } }
      ];
    }

    const events = await Event.find(query)
      .populate("organizerId", "name email category")
      .sort({ eventStartDate: 1 });
    res.json({ events });
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// GET /api/events/trending - Get top 5 trending events (most registrations in last 24h)
router.get("/trending", async (req, res) => {
  try {
    const oneDayAgo = new Date(new Date() - 24 * 60 * 60 * 1000);

    const trending = await Registration.aggregate([
      { $match: { createdAt: { $gte: oneDayAgo } } },
      { $group: { _id: "$eventId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    const eventIds = trending.map(t => t._id);
    const events = await Event.find({ _id: { $in: eventIds } })
      .populate("organizerId", "name email category");

    res.json({ events });
  } catch (error) {
    console.error("Error fetching trending events:", error);
    res.status(500).json({ error: "Failed to fetch trending events" });
  }
});

// GET /api/events/my-registrations - Get logged-in user's registrations
router.get("/my-registrations", authMiddleware, checkRole(["user"]), async (req, res) => {
  try {
    const registrations = await Registration.find({ userId: req.user._id })
      .populate({
        path: 'eventId',
        populate: { path: 'organizerId', select: 'name category' }
      })
      .sort({ registrationDate: -1 });
    res.json({ registrations });
  } catch (error) {
    console.error("Error fetching registrations:", error);
    res.status(500).json({ error: "Failed to fetch registrations" });
  }
});

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

      res.json({ event });
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
        status: "completed",
      });

      const summary = {
        totalRegistrations: events.reduce(
          (sum, e) => sum + e.totalRegistrations,
          0,
        ),
        totalRevenue: events.reduce((sum, e) => sum + e.totalRevenue, 0),
        totalAttendance: events.reduce((sum, e) => sum + e.totalAttendance, 0),
        completedEvents: events.length,
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
        .populate('userId', 'firstName lastName email collegeName')
        .sort({ registrationDate: -1 });

      // Format participant data
      const participants = registrations.map(reg => ({
        _id: reg._id,
        name: `${reg.userId?.firstName || ''} ${reg.userId?.lastName || ''}`.trim(),
        email: reg.userId?.email || 'N/A',
        collegeName: reg.userId?.collegeName || 'N/A',
        registrationDate: reg.registrationDate,
        paymentStatus: reg.paymentStatus,
        status: reg.status,
        teamName: reg.teamName || '-',
        ticketId: reg.ticketId,
        formData: reg.formData,
        merchandiseSelection: reg.merchandiseSelection
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
    const event = await Event.findById(req.params.id).populate(
      "organizerId",
      "name email category",
    );

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Only show published/ongoing events to public
    if (event.status !== "published" && event.status !== "ongoing") {
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
      !eventEndDate ||
      !registrationLimit
    ) {
      return res.status(400).json({ error: "Missing required fields" });
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
      return res
        .status(400)
        .json({
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
      registrationFee: registrationFee || 0,
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
        event.registrationFee = registrationFee;
      if (tags) event.tags = tags;
      if (customForm) event.customForm = customForm;
      if (merchandiseDetails) event.merchandiseDetails = merchandiseDetails;
      if (status) event.status = status;

      // Send Discord notification when publishing
      if (oldStatus === 'draft' && status === 'published') {
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
          return res
            .status(400)
            .json({
              error: "Can only extend registration deadline, not reduce it",
            });
        }
      }

      // Can increase limit
      if (registrationLimit) {
        if (registrationLimit >= event.registrationLimit) {
          event.registrationLimit = registrationLimit;
        } else {
          return res
            .status(400)
            .json({
              error: "Can only increase registration limit, not reduce it",
            });
        }
      }

      // Can close registrations
      if (status === "closed") {
        event.status = "closed";
        // Mark all non-scanned participants as absent
        await Registration.updateMany(
          { eventId: event._id, attendanceStatus: 'not_checked' },
          { 
            attendanceStatus: 'absent',
            attendanceTimestamp: new Date()
          }
        );
      }

      // Can mark as ongoing if start date has passed
      if (status === "ongoing") {
        event.status = "ongoing";
      }
    } else if (event.status === "ongoing" || event.status === "completed") {
      // Ongoing/Completed: only status changes
      if (status === "completed" || status === "closed") {
        event.status = status;
        // Mark all non-scanned participants as absent when completing or closing
        if (status === "completed" || status === "closed") {
          await Registration.updateMany(
            { eventId: event._id, attendanceStatus: 'not_checked' },
            { 
              attendanceStatus: 'absent',
              attendanceTimestamp: new Date()
            }
          );
        }
      } else {
        return res
          .status(400)
          .json({
            error: "Cannot edit ongoing/completed events except status",
          });
      }
    } else if (event.status === "closed") {
      return res.status(400).json({ error: "Cannot edit closed events" });
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

    await Event.findByIdAndDelete(req.params.id);

    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

// POST /api/events/:id/register - Register for event
router.post("/:id/register", authMiddleware, checkRole(["user"]), async (req, res) => {
  try {
    const eventId = req.params.id;
    const userId = req.user._id;
    const { formData, merchandiseSelection, teamName } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (event.status !== 'published' && event.status !== 'ongoing') {
      return res.status(400).json({ error: "Event is not open for registration" });
    }

    if (new Date() > new Date(event.registrationDeadline)) {
      return res.status(400).json({ error: "Registration deadline has passed" });
    }

    if (event.totalRegistrations >= event.registrationLimit) {
      return res.status(400).json({ error: "Registration limit reached" });
    }

    // Check already registered
    const existing = await Registration.findOne({ userId, eventId });
    if (existing) {
      return res.status(409).json({ error: "Already registered for this event" });
    }

    // Merchandise specific checks
    let variant = null;
    if (event.eventType === 'merchandise') {
      if (!merchandiseSelection || !merchandiseSelection.variantId) {
        return res.status(400).json({ error: "Please select a variant" });
      }
      // Check stock
      variant = event.merchandiseDetails.variants.find(v => v.variantId === merchandiseSelection.variantId);
      if (!variant) return res.status(400).json({ error: "Invalid variant" });
      if (variant.stockQuantity < (merchandiseSelection.quantity || 1)) {
        return res.status(400).json({ error: "Out of stock" });
      }

      // DON'T decrement stock here for merchandise with payment
      // Stock is decremented only after payment approval
    }

    const ticketId = uuidv4();

    // Determine payment status and approval workflow
    let paymentStatus = 'free';
    let paymentApprovalStatus = 'not_required';

    // For merchandise events with price > 0, require payment approval
    if (event.eventType === 'merchandise' && variant && variant.price > 0) {
      paymentStatus = 'pending';
      paymentApprovalStatus = 'pending'; // Requires payment proof upload and approval
    } else if (event.registrationFee > 0) {
      // For normal events with fees (simplified - mark as completed)
      paymentStatus = 'completed';
    }

    const registration = new Registration({
      userId,
      eventId,
      ticketId,
      status: 'registered',
      paymentStatus,
      paymentApprovalStatus,
      formData: event.eventType === 'normal' ? formData : undefined,
      merchandiseSelection: event.eventType === 'merchandise' ? merchandiseSelection : undefined,
      teamName,
      attendanceStatus: 'not_checked'
    });

    await registration.save();

    // Generate encrypted QR code
    const { qrCodeBuffer, encryptedData, iv } = await generateEncryptedQRCode({
      ticketId,
      userId: userId.toString(),
      eventId: eventId.toString(),
      eventName: event.name,
      userName: `${req.user.firstName} ${req.user.lastName}`,
      registrationDate: registration.registrationDate
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
        registrationFee: event.registrationFee || 0
      });
      console.log(`Registration email sent to ${req.user.email}`);
    } catch (emailError) {
      console.error('Failed to send registration email:', emailError);
      // Don't fail the registration if email fails
    }

    // Update event stats for normal events and free merchandise
    if (event.eventType === 'normal' || (event.eventType === 'merchandise' && (!variant || variant.price === 0))) {
      event.totalRegistrations += 1;
      if (event.registrationFee > 0) {
        event.totalRevenue += event.registrationFee;
      }
      // For free merchandise, decrement stock immediately
      if (event.eventType === 'merchandise' && variant) {
        variant.stockQuantity -= (merchandiseSelection.quantity || 1);
      }
      await event.save();
    }
    // For paid merchandise, stats are updated only after payment approval

    // Response message
    const requiresPaymentProof = paymentApprovalStatus === 'pending';
    res.status(201).json({
      message: requiresPaymentProof
        ? "Registration received! Please upload payment proof."
        : "Registration successful!",
      ticketId,
      requiresPaymentProof,
      registrationId: registration._id
    });

  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: error.message || "Registration failed" });
  }
});

// ===============================================
// PAYMENT APPROVAL WORKFLOW ENDPOINTS (13.1.1)
// ===============================================

// POST /api/events/:id/upload-payment-proof - Upload payment proof image
router.post(
  "/:id/upload-payment-proof",
  authMiddleware,
  checkRole(["user"]),
  paymentProofUpload.single('paymentProof'),
  async (req, res) => {
    try {
      const eventId = req.params.id;
      const userId = req.user._id;

      if (!req.file) {
        return res.status(400).json({ error: "Payment proof image is required" });
      }

      const registration = await Registration.findOne({ userId, eventId });
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      if (registration.paymentApprovalStatus !== 'pending') {
        return res.status(400).json({ error: "Payment proof not required or already submitted" });
      }

      // Save the file path
      registration.paymentProofImage = `/uploads/payment-proofs/${req.file.filename}`;
      await registration.save();

      res.json({
        message: "Payment proof uploaded successfully. Awaiting approval.",
        imagePath: registration.paymentProofImage
      });
    } catch (error) {
      console.error("Payment proof upload error:", error);
      res.status(500).json({ error: "Failed to upload payment proof" });
    }
  }
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
        paymentApprovalStatus: { $in: ['pending'] }
      })
        .populate('userId', 'firstName lastName email collegeName')
        .sort({ createdAt: -1 });

      // Also get recently processed for reference
      const recentlyProcessed = await Registration.find({
        eventId: req.params.id,
        paymentApprovalStatus: { $in: ['approved', 'rejected'] }
      })
        .populate('userId', 'firstName lastName email')
        .sort({ paymentApprovalDate: -1 })
        .limit(20);

      res.json({
        pending: pendingPayments.map(p => ({
          _id: p._id,
          ticketId: p.ticketId,
          user: p.userId,
          merchandiseSelection: p.merchandiseSelection,
          paymentProofImage: p.paymentProofImage,
          createdAt: p.createdAt
        })),
        recentlyProcessed: recentlyProcessed.map(p => ({
          _id: p._id,
          ticketId: p.ticketId,
          user: p.userId,
          status: p.paymentApprovalStatus,
          processedAt: p.paymentApprovalDate,
          rejectionReason: p.paymentRejectionReason
        }))
      });
    } catch (error) {
      console.error("Error fetching pending payments:", error);
      res.status(500).json({ error: "Failed to fetch pending payments" });
    }
  }
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

      if (registration.paymentApprovalStatus !== 'pending') {
        return res.status(400).json({ error: "Payment already processed" });
      }

      if (!registration.paymentProofImage) {
        return res.status(400).json({ error: "No payment proof uploaded yet" });
      }

      // Approve the payment
      registration.paymentApprovalStatus = 'approved';
      registration.paymentApprovalDate = new Date();
      registration.paymentApprovedBy = req.user._id;
      registration.paymentStatus = 'completed';
      await registration.save();

      // Now decrement stock and update event stats
      if (registration.merchandiseSelection && registration.merchandiseSelection.variantId) {
        const variant = event.merchandiseDetails.variants.find(
          v => v.variantId === registration.merchandiseSelection.variantId
        );
        if (variant) {
          variant.stockQuantity -= (registration.merchandiseSelection.quantity || 1);
          event.totalRevenue += (variant.price * (registration.merchandiseSelection.quantity || 1));
        }
      }
      event.totalRegistrations += 1;
      await event.save();

      // Emit Socket.io event for real-time updates
      const io = req.app.get('io');
      if (io) {
        io.emit('payment:approved', {
          eventId,
          registrationId: registration._id,
          userId: registration.userId
        });
        io.emit('event:updated', { eventId });
      }

      // TODO: Send confirmation email with ticket

      res.json({
        message: "Payment approved successfully",
        registration: {
          _id: registration._id,
          ticketId: registration.ticketId,
          status: registration.paymentApprovalStatus
        }
      });
    } catch (error) {
      console.error("Payment approval error:", error);
      res.status(500).json({ error: "Failed to approve payment" });
    }
  }
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

      if (registration.paymentApprovalStatus !== 'pending') {
        return res.status(400).json({ error: "Payment already processed" });
      }

      // Reject the payment
      registration.paymentApprovalStatus = 'rejected';
      registration.paymentApprovalDate = new Date();
      registration.paymentApprovedBy = req.user._id;
      registration.paymentRejectionReason = reason || 'Payment rejected by organizer';
      await registration.save();

      // Emit Socket.io event for real-time updates
      const io = req.app.get('io');
      if (io) {
        io.emit('payment:rejected', {
          eventId,
          registrationId: registration._id,
          userId: registration.userId,
          reason: registration.paymentRejectionReason
        });
        io.emit('event:updated', { eventId });
      }

      res.json({
        message: "Payment rejected",
        registration: {
          _id: registration._id,
          ticketId: registration.ticketId,
          status: registration.paymentApprovalStatus
        }
      });
    } catch (error) {
      console.error("Payment rejection error:", error);
      res.status(500).json({ error: "Failed to reject payment" });
    }
  }
);

// ===============================================
// QR SCANNER & ATTENDANCE TRACKING (13.1.2)
// ===============================================

// GET /api/events/:eventId/ticket/:registrationId/qr - Generate QR code for ticket
router.get(
  "/:eventId/ticket/:registrationId/qr",
  authMiddleware,
  async (req, res) => {
    try {
      const { eventId, registrationId } = req.params;

      const registration = await Registration.findById(registrationId)
        .populate('userId', 'firstName lastName email')
        .populate('eventId', 'name eventStartDate');

      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      // Only allow ticket owner or organizer to access
      const event = await Event.findById(eventId);
      const isOwner = registration.userId._id.toString() === req.user._id?.toString();
      const isOrganizer = event?.organizerId.toString() === req.user._id?.toString();

      if (!isOwner && !isOrganizer) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // Check if payment is approved for merchandise events
      if (registration.paymentApprovalStatus === 'pending') {
        return res.status(400).json({ error: "QR not available - payment pending approval" });
      }
      if (registration.paymentApprovalStatus === 'rejected') {
        return res.status(400).json({ error: "QR not available - payment was rejected" });
      }

      // Generate QR code data
      const qrData = JSON.stringify({
        ticketId: registration.ticketId,
        eventId: eventId,
        registrationId: registrationId,
        userId: registration.userId._id,
        timestamp: Date.now()
      });

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });

      res.json({
        qrCode: qrCodeDataUrl,
        ticketInfo: {
          ticketId: registration.ticketId,
          eventName: registration.eventId.name,
          participantName: `${registration.userId.firstName} ${registration.userId.lastName}`,
          eventDate: registration.eventId.eventStartDate
        }
      });
    } catch (error) {
      console.error("QR generation error:", error);
      res.status(500).json({ error: "Failed to generate QR code" });
    }
  }
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

      // Parse QR data if provided
      let parsedQR = null;
      if (qrData) {
        try {
          parsedQR = JSON.parse(qrData);
        } catch (e) {
          return res.status(400).json({ error: "Invalid QR code data" });
        }
      }

      const searchTicketId = ticketId || parsedQR?.ticketId;
      if (!searchTicketId) {
        return res.status(400).json({ error: "Ticket ID is required" });
      }

      const registration = await Registration.findOne({
        ticketId: searchTicketId,
        eventId: eventId
      }).populate('userId', 'firstName lastName email collegeName');

      if (!registration) {
        return res.status(404).json({ error: "Ticket not found for this event" });
      }

      // Check if payment is approved for merchandise events
      if (registration.paymentApprovalStatus === 'pending') {
        return res.status(400).json({ error: "Cannot mark attendance - payment pending" });
      }
      if (registration.paymentApprovalStatus === 'rejected') {
        return res.status(400).json({ error: "Cannot mark attendance - payment rejected" });
      }

      // Check for duplicate scan
      if (registration.attendanceStatus === 'present') {
        // Log the duplicate scan attempt
        registration.scanHistory.push({
          timestamp: new Date(),
          action: 'duplicate_rejected',
          performedBy: req.user._id,
          notes: 'Duplicate scan attempt rejected'
        });
        await registration.save();

        return res.status(409).json({
          error: "Duplicate scan - Attendance already marked",
          alreadyMarkedAt: registration.attendanceTimestamp,
          participant: {
            name: `${registration.userId.firstName} ${registration.userId.lastName}`,
            email: registration.userId.email
          }
        });
      }

      // Mark attendance
      registration.attendanceStatus = 'present';
      registration.attendanceTimestamp = new Date();
      registration.attendanceMarkedBy = req.user._id;
      registration.status = 'attended';

      // Add to scan history
      registration.scanHistory.push({
        timestamp: new Date(),
        action: 'scanned',
        performedBy: req.user._id
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
          markedAt: registration.attendanceTimestamp
        }
      });
    } catch (error) {
      console.error("Ticket scan error:", error);
      res.status(500).json({ error: "Failed to process ticket scan" });
    }
  }
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

      if (!['present', 'absent'].includes(status)) {
        return res.status(400).json({ error: "Status must be 'present' or 'absent'" });
      }

      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ error: "Reason is required for manual override (min 5 characters)" });
      }

      const event = await Event.findById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      if (event.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      const registration = await Registration.findById(registrationId)
        .populate('userId', 'firstName lastName email');

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
      registration.status = status === 'present' ? 'attended' : 'registered';

      // Add to audit log
      registration.scanHistory.push({
        timestamp: new Date(),
        action: status === 'present' ? 'manual_present' : 'manual_absent',
        performedBy: req.user._id,
        notes: reason
      });

      await registration.save();

      // Update event attendance stats
      if (previousStatus !== 'present' && status === 'present') {
        event.totalAttendance += 1;
      } else if (previousStatus === 'present' && status === 'absent') {
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
          reason: reason
        }
      });
    } catch (error) {
      console.error("Manual attendance error:", error);
      res.status(500).json({ error: "Failed to update attendance" });
    }
  }
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
          { paymentApprovalStatus: 'not_required' },
          { paymentApprovalStatus: 'approved' }
        ]
      }).populate('userId', 'firstName lastName email collegeName');

      const present = registrations.filter(r => r.attendanceStatus === 'present');
      const notChecked = registrations.filter(r => r.attendanceStatus === 'not_checked');
      const absent = registrations.filter(r => r.attendanceStatus === 'absent');

      res.json({
        stats: {
          totalRegistered: registrations.length,
          present: present.length,
          notYetScanned: notChecked.length,
          absent: absent.length,
          attendanceRate: registrations.length > 0
            ? ((present.length / registrations.length) * 100).toFixed(1)
            : 0
        },
        participants: registrations.map(r => ({
          _id: r._id,
          name: `${r.userId?.firstName || ''} ${r.userId?.lastName || ''}`.trim(),
          email: r.userId?.email,
          collegeName: r.userId?.collegeName,
          ticketId: r.ticketId,
          attendanceStatus: r.attendanceStatus,
          attendanceTimestamp: r.attendanceTimestamp,
          manualOverride: r.manualOverride,
          overrideReason: r.overrideReason
        }))
      });
    } catch (error) {
      console.error("Attendance dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch attendance data" });
    }
  }
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
          { paymentApprovalStatus: 'not_required' },
          { paymentApprovalStatus: 'approved' }
        ]
      }).populate('userId', 'firstName lastName email collegeName');

      // Generate CSV
      const headers = ['Name', 'Email', 'College', 'Ticket ID', 'Attendance Status', 'Check-in Time', 'Manual Override', 'Override Reason'];
      const rows = registrations.map(r => [
        `${r.userId?.firstName || ''} ${r.userId?.lastName || ''}`.trim(),
        r.userId?.email || 'N/A',
        r.userId?.collegeName || 'N/A',
        r.ticketId,
        r.attendanceStatus,
        r.attendanceTimestamp ? new Date(r.attendanceTimestamp).toLocaleString() : 'N/A',
        r.manualOverride ? 'Yes' : 'No',
        r.overrideReason || ''
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${event.name}_attendance.csv"`);
      res.send(csvContent);
    } catch (error) {
      console.error("Attendance export error:", error);
      res.status(500).json({ error: "Failed to export attendance" });
    }
  }
);

// POST /api/events/verify-qr - Verify and decrypt QR code for check-in
router.post(
  "/verify-qr",
  authMiddleware,
  checkRole(["club", "admin"]),
  async (req, res) => {
    try {
      const { qrData } = req.body;
      
      if (!qrData) {
        return res.status(400).json({ error: "QR data is required" });
      }

      // Parse the QR data
      let parsedData;
      try {
        parsedData = JSON.parse(qrData);
      } catch (e) {
        return res.status(400).json({ error: "Invalid QR code format" });
      }

      const { data: encryptedData, iv } = parsedData;
      
      if (!encryptedData || !iv) {
        return res.status(400).json({ error: "Invalid QR code data" });
      }

      // Decrypt the QR code
      const { decryptQRData } = require('../utils/emailService');
      let decryptedData;
      try {
        decryptedData = JSON.parse(decryptQRData(encryptedData, iv));
      } catch (e) {
        return res.status(400).json({ error: "Failed to decrypt QR code" });
      }

      const { ticketId, userId, eventId } = decryptedData;

      // Verify registration exists
      const registration = await Registration.findOne({
        ticketId,
        userId,
        eventId
      })
        .populate('userId', 'firstName lastName email collegeName')
        .populate('eventId', 'name eventStartDate location organizerId');

      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      // Check if the user has permission to verify this event
      if (req.user.type === 'club' && 
          registration.eventId.organizerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: "Unauthorized to verify this event" });
      }

      res.json({
        valid: true,
        registration: {
          ticketId: registration.ticketId,
          userName: `${registration.userId.firstName} ${registration.userId.lastName}`,
          email: registration.userId.email,
          collegeName: registration.userId.collegeName,
          eventName: registration.eventId.name,
          eventDate: registration.eventId.eventStartDate,
          registrationStatus: registration.status,
          attendanceStatus: registration.attendanceStatus,
          paymentStatus: registration.paymentStatus,
          registrationDate: registration.registrationDate
        }
      });

    } catch (error) {
      console.error("QR verification error:", error);
      res.status(500).json({ error: "Failed to verify QR code" });
    }
  }
);

module.exports = router;
