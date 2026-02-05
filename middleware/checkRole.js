module.exports = function checkRole(allowedTypes = []) {
  return (req, res, next) => {
    // authMiddleware should be done before role check
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    // check if user type is in allowed types
    if (!allowedTypes.includes(req.user.type)) {
      return res
        .status(403)
        .json({ error: "Forbidden - insufficient permissions" });
    }
    next();
  };
};
