const express = require("express");
const Club = require("../models/club");
const User = require("../models/user");
const PasswordResetRequest = require("../models/passwordResetRequest");
const authMiddleware = require("../middleware/authMiddleware");
const checkRole = require("../middleware/checkRole");

const router = express.Router();

// GET /api/clubs - get all clubs (for onboarding and general browsing)
router.get("/", async (req, res) => {
  try {
    // Only show enabled clubs to public
    const clubs = await Club.find({ enabled: true }).select(
      "-password -followers.userId",
    );
    res.json(clubs);
  } catch (error) {
    console.error("Error fetching clubs:", error);
    res.status(500).json({ error: "Server error fetching clubs" });
  }
});

// POST /api/clubs/follow - follow a club
router.post(
  "/follow",
  authMiddleware,
  checkRole(["user"]),
  async (req, res) => {
    try {
      const { clubId, clubIds } = req.body;
      const userId = req.user._id;
      // if clubIds exists and is an array, use it. Otherwise, if clubId exists, use it as a single club to follow
      const clubsToFollow =
        clubIds && Array.isArray(clubIds) ? clubIds : clubId ? [clubId] : [];
      if (clubsToFollow.length === 0) {
        return res
          .status(400)
          .json({ error: "Club ID or Club IDs are required" });
      }
      const results = [];
      for (const id of clubsToFollow) {
        try {
          const club = await Club.findById(id);
          if (!club) {
            results.push({
              clubId: id,
              status: "error",
              message: "Club not found",
            });
            continue;
          }
          // Check if club is enabled
          if (!club.enabled) {
            results.push({
              clubId: id,
              status: "error",
              message: "Club is disabled",
            });
            continue;
          }
          // Check if already following
          let isAlreadyFollowing = false;
          for (const follower of club.followers) {
            if (follower.userId.toString() === userId.toString()) {
              isAlreadyFollowing = true;
              break;
            }
          }
          if (isAlreadyFollowing) {
            results.push({
              clubId: id,
              status: "already_following",
              message: "Already following this club",
            });
            continue;
          }
          // Add follower to club
          club.followers.push({ userId });
          await club.save(); // this triggers the pre-save hook to update followerCount
          // Update user's followedClubs
          await User.findByIdAndUpdate(userId, {
            $addToSet: { followedClubs: id },
          });
          results.push({
            clubId: id,
            status: "success",
            message: "Club followed successfully",
          });
        } catch (error) {
          console.error(`Error following club ${id}:`, error);
          results.push({
            clubId: id,
            status: "error",
            message: "Failed to follow club",
          });
        }
      }
      const successCount = results.filter((r) => r.status === "success").length;
      res.json({
        message: `${successCount} club(s) followed successfully`,
        results,
      });
    } catch (error) {
      console.error("Error following clubs:", error);
      res.status(500).json({ error: "Server error following clubs" });
    }
  },
);

// POST /api/clubs/unfollow - unfollow a club
router.post(
  "/unfollow",
  authMiddleware,
  checkRole(["user"]),
  async (req, res) => {
    try {
      const { clubId } = req.body;
      const userId = req.user._id;
      if (!clubId) {
        return res.status(400).json({ error: "Club ID is required" });
      }
      const club = await Club.findById(clubId);
      if (!club) {
        return res.status(404).json({ error: "Club not found" });
      }
      // removes follower from club's followers array
      club.followers = club.followers.filter(
        (follower) => follower.userId.toString() !== userId.toString(),
      );
      await club.save(); // triggers pre-save hook to update followerCount
      // removes club from user's followedClubs array
      await User.findByIdAndUpdate(userId, {
        $pull: { followedClubs: clubId },
      });
      res.json({
        message: "Club unfollowed successfully",
        followerCount: club.followerCount,
      });
    } catch (error) {
      console.error("Error unfollowing club:", error);
      res.status(500).json({ error: "Server error unfollowing club" });
    }
  },
);

// GET /api/clubs/profile - gets profile of logged in club
router.get(
  "/profile",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const club = await Club.findById(req.user._id)
        .select("-password")
        .populate("followers.userId", "firstName lastName email"); // this gets the actual data from the referenced user IDs in followers array, but only selects firstName, lastName, and email for privacy
      if (!club) {
        return res.status(404).json({ error: "Club not found" });
      }
      res.json(club);
    } catch (error) {
      console.error("Error fetching club profile:", error);
      res.status(500).json({ error: "Server error fetching club profile" });
    }
  },
);

// PATCH /api/clubs/profile - Update club profile (for logged in clubs)
router.patch(
  "/profile",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const {
        description,
        category,
        contactEmail,
        phoneNumber,
        website,
        socialLinks,
        discordWebhook,
      } = req.body;
      const updateData = {};
      if (description) updateData.description = description;
      if (category) updateData.category = category;
      if (contactEmail) updateData.contactEmail = contactEmail;
      if (phoneNumber) updateData.phoneNumber = phoneNumber;
      if (website) updateData.website = website;
      if (socialLinks) updateData.socialLinks = socialLinks;
      if (discordWebhook !== undefined)
        updateData.discordWebhook = discordWebhook;
      const club = await Club.findByIdAndUpdate(
        req.user._id,
        { $set: updateData },
        { new: true, runValidators: true },
      ).select("-password");
      if (!club) {
        return res.status(404).json({ error: "Club not found" });
      }
      res.json({
        message: "Profile updated successfully",
        club,
      });
    } catch (error) {
      console.error("Error updating club profile:", error);
      res.status(500).json({ error: "Server error updating club profile" });
    }
  },
);

// POST /api/clubs/password-reset-request - Request password reset (for logged-in clubs)
router.post(
  "/password-reset-request",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const { reason } = req.body;
      const clubId = req.user._id;

      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({
          error: "Please provide a reason (minimum 10 characters)",
        });
      }

      // Check if there's already a pending request
      const existingRequest = await PasswordResetRequest.findOne({
        clubId,
        status: "pending",
      });

      if (existingRequest) {
        return res.status(400).json({
          error: "You already have a pending password reset request",
        });
      }

      // Create new request
      const request = new PasswordResetRequest({
        clubId,
        reason: reason.trim(),
        status: "pending",
      });

      await request.save();

      res.status(201).json({
        message: "Password reset request submitted successfully",
        request: {
          id: request._id,
          reason: request.reason,
          status: request.status,
          createdAt: request.createdAt,
        },
      });
    } catch (error) {
      console.error("Error creating password reset request:", error);
      res
        .status(500)
        .json({ error: "Failed to submit password reset request" });
    }
  },
);

// GET /api/clubs/my-password-requests - Get club's password reset history
router.get(
  "/my-password-requests",
  authMiddleware,
  checkRole(["club"]),
  async (req, res) => {
    try {
      const requests = await PasswordResetRequest.find({
        clubId: req.user._id,
      })
        .sort({ createdAt: -1 })
        .select("-newPassword"); // Don't send password to club

      res.json({ requests });
    } catch (error) {
      console.error("Error fetching password reset history:", error);
      res.status(500).json({ error: "Failed to fetch password reset history" });
    }
  },
);

// GET /api/clubs/:id - Get specific club details
router.get("/:id", async (req, res) => {
  try {
    const club = await Club.findById(req.params.id)
      .select("-password -followers.userId") // Don't expose follower details publicly
      .populate({
        path: "followers",
        select: "followedAt",
        options: { limit: 0 }, // Just for count
      });
    if (!club) {
      return res.status(404).json({ error: "Club not found" });
    }
    // Don't show disabled clubs publicly
    if (!club.enabled) {
      return res.status(404).json({ error: "Club not found" });
    }
    res.json(club);
  } catch (error) {
    console.error("Error fetching club:", error);
    res.status(500).json({ error: "Server error fetching club" });
  }
});

module.exports = router;
