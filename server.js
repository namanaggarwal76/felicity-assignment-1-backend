require("dotenv").config(); // load env variables
const express = require("express"); // for APIs
const cors = require("cors"); // cors middleware
const mongoose = require("mongoose"); // for mondodb connection
const path = require("path"); // make sure file paths work across diff operating systems
const app = express(); // initialise express app

// cors middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// parsing json bodies
app.use(express.json());

// cors for images 
app.use(
  "/uploads",
  (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET");
    res.header("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "uploads")),
);

// mongodb connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

// api routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/events", require("./routes/events"));
app.use("/api/clubs", require("./routes/clubs"));
app.use("/api/discussions", require("./routes/discussions"));
app.use("/api/feedback", require("./routes/feedback"));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
