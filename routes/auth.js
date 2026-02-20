const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Club = require("../models/club");
const Admin = require("../models/admin");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// POST /api/auth/register - register a new user
router.post("/register", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      collegeName,
      isIIITan,
    } = req.body;
    if (!firstName || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    // check if email already exists in any user type
    const [existingUser, existingClub, existingAdmin] = await Promise.all([
      User.findOne({ email }),
      Club.findOne({ email }),
      Admin.findOne({ email }),
    ]);
    if (existingUser || existingClub || existingAdmin) {
      return res.status(409).json({ error: "Email already registered" });
    }
    // check regex and validate with bool
    const IIIT_REGEX = /^[^@.\s]+(\.[^@.\s]+)+@([a-zA-Z0-9-]+\.)?iiit\.ac\.in$/;
    if (isIIITan && !IIIT_REGEX.test(email.toLowerCase())) {
      return res.status(400).json({
        error: "IIITans must use a valid IIIT email",
      });
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      isIIITian: isIIITan || false,
      contactNumber: phoneNumber,
      collegeName: isIIITan ? "IIIT Hyderabad" : collegeName,
    });
    await user.save();
    const token = jwt.sign(
      { id: user._id, type: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );
    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        type: "user",
        onboardingCompleted: false,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Server error during registration" });
  }
});

// POST /api/auth/login - login for all types of users
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    let user = null;
    let type = null;
    // find the user in User collection
    user = await User.findOne({ email }).select("+password");
    if (user) {
      type = "user";
    } else {
      // try clubs collection
      user = await Club.findOne({ email }).select("+password");
      if (user) {
        type = "club";
      } else {
        // try admins collection
        user = await Admin.findOne({ email }).select("+password");
        if (user) {
          type = "admin";
        }
      }
    }
    // couldnt find anywhere
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }   
    // Check if club is enabled
    if (type === "club" && user.enabled === false) {
      return res.status(403).json({ 
        error: "Your account has been disabled. Please contact the administrator." 
      });
    }

    // check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    // generate JWT token
    const token = jwt.sign({ id: user._id, type }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    const responseData = {
      token,
      user: {
        id: user._id,
        email: user.email,
        type,
      },
    };
    // add extra fields based on type
    if (type === "user") {
      responseData.user = {
        ...responseData.user,
        firstName: user.firstName,
        lastName: user.lastName,
        onboardingCompleted: user.onboardingCompleted,
      };
    } else if (type === "club") {
      responseData.user = {
        ...responseData.user,
        name: user.name,
        category: user.category,
        followerCount: user.followerCount,
      };
    } else if (type === "admin") {
      responseData.user = {
        ...responseData.user,
        firstName: user.firstName,
        lastName: user.lastName,
      };
    }
    res.json(responseData);
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error during login" });
  }
});

// PATCH /api/auth/onboarding - for completing the onboarding process (follow interests + followed clubs)
router.patch("/onboarding", authMiddleware, async (req, res) => {
  try {
    if (req.user.type !== "user") {
      return res
        .status(403)
        .json({ error: "Only users can complete onboarding" });
    }
    const { interests, followedClubs } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        interests: interests,
        followedClubs: followedClubs,
        onboardingCompleted: true,
      },
    });
    res.json({ message: "Onboarding completed successfully" });
  } catch (error) {
    console.error("Onboarding error:", error);
    res.status(500).json({ error: "Server error during onboarding" });
  }
});

// PATCH /api/auth/profile - update user profile
router.patch("/profile", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const userType = req.user.type;

    let updatedUser;

    if (userType === "user") {
      const { firstName, lastName, contactNumber, collegeName, interests } =
        req.body;
      updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          firstName,
          lastName,
          contactNumber,
          collegeName,
          interests,
        },
        { new: true },
      ).select("-password");
    } else if (userType === "club") {
      const { 
        name, 
        description, 
        category, 
        contactEmail, 
        phoneNumber, 
        website,
        discordWebhook,
        socialLinks
      } = req.body;
      
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (category !== undefined) updateData.category = category;
      if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
      if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
      if (website !== undefined) updateData.website = website;
      if (discordWebhook !== undefined) updateData.discordWebhook = discordWebhook;
      if (socialLinks !== undefined) updateData.socialLinks = socialLinks;

      updatedUser = await Club.findByIdAndUpdate(
        userId,
        updateData,
        { new: true },
      ).select("-password");
    }

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Return updated user info suitable for frontend state
    res.json({ message: "Profile updated", user: updatedUser });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ error: "Server error updating profile" });
  }
});

// POST /api/auth/change-password
router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;
    let user;

    if (req.user.type === "user")
      user = await User.findById(userId).select("+password");
    else if (req.user.type === "club") {
      console.error(
        "Password change error: Clubs cannot change password via this route",
      );
      res.status(500).json({ error: "Server error changing password" });
    } else if (req.user.type === "admin") {
      console.error(
        "Password change error: Admins cannot change password via this route",
      );
      res.status(500).json({ error: "Server error changing password" });
    }

    if (!user) return res.status(404).json({ error: "User not found" });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch)
      return res.status(400).json({ error: "Incorrect current password" });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    res.status(500).json({ error: "Server error changing password" });
  }
});

// GET /api/auth/validate-token - validate if token is still valid
router.get("/validate-token", authMiddleware, async (req, res) => {
  try {
    // If we reach here, the middleware has already validated the token and user exists
    res.status(200).json({
      valid: true,
      user: {
        id: req.user._id,
        email: req.user.email,
        type: req.user.type,
      },
    });
  } catch (error) {
    console.error("Token validation error:", error);
    res.status(401).json({ error: "Token validation failed" });
  }
});

module.exports = router;
