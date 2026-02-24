const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Club = require("../models/club");
const Admin = require("../models/admin");

module.exports = async function authMiddleware(req, res, next) {
  try {
    // get the authorization header
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer")) {
      return res.status(401).json({ error: "No token provided" });
    }
    // get the token from header
    const token = auth.split(" ")[1];
    // jwt decode and verify
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let user = null;
    // get the user type from decoded token
    const type = decoded.type;
    // diff options for type to be
    if (!type) return res.status(401).json({ error: "Token type missing" });
    if (type === "admin") {
      user = await Admin.findById(decoded.id).select("-password");
    } else if (type === "club") {
      user = await Club.findById(decoded.id).select("-password");
      // Check if club account is enabled
      if (user && !user.enabled) {
        return res
          .status(403)
          .json({ error: "Club account is disabled. Contact admin." });
      }
    } else {
      user = await User.findById(decoded.id)
        .select("-password")
        .populate("followedClubs", "name category");
    }
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    // convert mongoose document to json file and add a property "type"
    req.user = { ...user.toObject(), type };
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({ error: "Token invalid or expired" });
  }
};
