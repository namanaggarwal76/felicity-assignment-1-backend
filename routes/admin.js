const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Club = require("../models/club");
const Admin = require("../models/admin");
const PasswordResetRequest = require("../models/passwordResetRequest");
const bcrypt = require("bcryptjs");
const authMiddleware = require("../middleware/authMiddleware");
const checkRole = require("../middleware/checkRole");

// checks authmiddleware and admin role in all api calls for restricted access

// GET /api/admin/clubs - get list of all clubs
router.get("/clubs", authMiddleware, checkRole(["admin"]), async (req, res) => {
  try {
    // fetch all clubs without passwords
    const clubs = await Club.find({}).select("-password");
    res.json({ clubs });
  } catch (error) {
    // throws an error if something goes wrong
    console.error("Error fetching clubs:", error);
    res.status(500).json({ error: "Failed to fetch clubs" });
  }
});

// POST /api/admin/clubs - create a new club
router.post(
  "/clubs",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      // gets name, email from request body (password will be auto-generated)
      const { name, email } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }
      // check if same email exits in any user type, we wait for all 3 checks to complete (so await promise.all)
      const [existingUser, existingClub, existingAdmin] = await Promise.all([
        User.findOne({ email }),
        Club.findOne({ email }),
        Admin.findOne({ email }),
      ]);

      // if email exists in any model, return conflict error
      if (existingUser || existingClub || existingAdmin) {
        return res.status(409).json({ error: "Email already exists" });
      }

      // Generate secure password server-side
      const generatePassword = () => {
        const chars =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&";
        let password = "";
        for (let i = 0; i < 12; i++) {
          password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
      };

      const generatedPassword = generatePassword();

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(generatedPassword, saltRounds);

      // add mininal info for now, club can update later
      const club = new Club({
        name,
        email,
        password: hashedPassword,
      });

      await club.save();

      res.status(201).json({
        message: "Club created successfully",
        club: {
          id: club._id,
          name: club.name,
          email: club.email,
          category: club.category,
          createdAt: club.createdAt,
        },
        generatedPassword: generatedPassword, // Return plaintext password for admin to share
      });
    } catch (error) {
      console.error("Error creating club:", error);
      res.status(500).json({ error: "Failed to create club" });
    }
  },
);

// PATCH /api/admin/clubs/:id/toggle - toggle club enabled/disabled status
router.patch(
  "/clubs/:id/toggle",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const club = await Club.findById(id);
      if (!club) {
        return res.status(404).json({ error: "Club not found" });
      }

      // Toggle enabled status
      club.enabled = !club.enabled;
      await club.save();

      res.json({
        message: `Club ${club.enabled ? "enabled" : "disabled"} successfully`,
        club: {
          id: club._id,
          name: club.name,
          enabled: club.enabled,
        },
      });
    } catch (error) {
      console.error("Error toggling club status:", error);
      res.status(500).json({ error: "Failed to toggle club status" });
    }
  },
);

// DELETE /api/admin/clubs/:id - delete a club
router.delete(
  "/clubs/:id",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const club = await Club.findByIdAndDelete(id);
      if (!club) {
        return res.status(404).json({ error: "Club not found" });
      }

      // TODO: Also clean up related events, followers, etc.
      // Remove club from users' followedClubs
      await User.updateMany(
        { followedClubs: id },
        { $pull: { followedClubs: id } },
      );

      res.json({ message: "Club deleted successfully" });
    } catch (error) {
      console.error("Error deleting club:", error);
      res.status(500).json({ error: "Failed to delete club" });
    }
  },
);

// GET /api/admin/users - get all users
router.get("/users", authMiddleware, checkRole(["admin"]), async (req, res) => {
  try {
    // fetch all users without passwords
    const users = await User.find({}).select("-password");
    res.json({ users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /api/admin/stats - get number of users and clubs
router.get("/stats", authMiddleware, checkRole(["admin"]), async (req, res) => {
  try {
    // fetch all data
    const [totalUsers, totalClubs] = await Promise.all([
      User.countDocuments({}),
      Club.countDocuments({}),
    ]);
    res.json({
      stats: {
        totalUsers,
        totalClubs,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// GET /api/admin/password-requests - get all password reset requests
router.get(
  "/password-requests",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { status } = req.query; // Filter by status: pending, approved, rejected
      const query = status ? { status } : {};

      const requests = await PasswordResetRequest.find(query)
        .populate("clubId", "name email")
        .populate("reviewedBy", "firstName lastName email")
        .sort({ createdAt: -1 });

      res.json({ requests });
    } catch (error) {
      console.error("Error fetching password reset requests:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch password reset requests" });
    }
  },
);

// POST /api/admin/password-requests/:id/approve - approve a password reset request
router.post(
  "/password-requests/:id/approve",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { adminComment } = req.body;

      // Find the request
      const request =
        await PasswordResetRequest.findById(id).populate("clubId");
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (request.status !== "pending") {
        return res.status(400).json({ error: "Request already processed" });
      }

      // Generate new password
      const generatePassword = () => {
        const chars =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&";
        let password = "";
        for (let i = 0; i < 12; i++) {
          password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
      };

      const newPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update club password
      await Club.findByIdAndUpdate(request.clubId._id, {
        password: hashedPassword,
      });

      // Update request
      request.status = "approved";
      request.adminComment = adminComment || "";
      request.newPassword = newPassword; // Store temporarily for admin to share
      request.reviewedBy = req.user._id;
      request.reviewedAt = new Date();
      await request.save();

      res.json({
        message: "Password reset approved successfully",
        clubName: request.clubId.name,
        clubEmail: request.clubId.email,
        newPassword: newPassword,
      });
    } catch (error) {
      console.error("Error approving password reset:", error);
      res.status(500).json({ error: "Failed to approve password reset" });
    }
  },
);

// POST /api/admin/password-requests/:id/reject - reject a password reset request
router.post(
  "/password-requests/:id/reject",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { adminComment } = req.body;

      const request = await PasswordResetRequest.findById(id).populate(
        "clubId",
        "name email",
      );
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (request.status !== "pending") {
        return res.status(400).json({ error: "Request already processed" });
      }

      request.status = "rejected";
      request.adminComment = adminComment || "";
      request.reviewedBy = req.user._id;
      request.reviewedAt = new Date();
      await request.save();

      res.json({
        message: "Password reset request rejected",
        clubName: request.clubId.name,
      });
    } catch (error) {
      console.error("Error rejecting password reset:", error);
      res.status(500).json({ error: "Failed to reject password reset" });
    }
  },
);

// GET /api/admin/password-requests/:id - Get specific password reset request with password
router.get(
  "/password-requests/:id",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const request = await PasswordResetRequest.findById(req.params.id)
        .populate("clubId", "name email")
        .populate("reviewedBy", "firstName lastName email")
        .select("+newPassword"); // Include password if approved

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      res.json({ request });
    } catch (error) {
      console.error("Error fetching request:", error);
      res.status(500).json({ error: "Failed to fetch request" });
    }
  },
);

// POST /api/admin/create-admin - create a new admin (development only, need to figure out or remove later)
router.post("/create-admin", async (req, res) => {
  try {
    // gets firstName, lastName, email, password from request body
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !email || !password) {
      return res
        .status(400)
        .json({ error: "First name, email, and password are required" });
    }
    // check if email already exists in any type of user
    const [existingUser, existingClub, existingAdmin] = await Promise.all([
      User.findOne({ email }),
      Club.findOne({ email }),
      Admin.findOne({ email }),
    ]);
    if (existingUser || existingClub || existingAdmin) {
      return res.status(409).json({ error: "Email already exists" });
    }
    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const admin = new Admin({
      firstName,
      lastName,
      email,
      password: hashedPassword,
    });
    await admin.save();
    res.status(201).json({
      message: "Admin account created successfully",
      admin: {
        id: admin._id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        createdAt: admin.createdAt,
      },
    });
  } catch (error) {
    console.error("Error creating admin:", error);
    res.status(500).json({ error: "Failed to create admin account" });
  }
});

module.exports = router;
