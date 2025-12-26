/*************************************************
 * ZWIFTY INTERNSHIP EXAM – SERVER (MONGODB FINAL)
 *************************************************/
console.log("🔥 ZWIFTY SERVER RUNNING WITH MONGODB");

/* ================== EXAM TIME CONFIG ================== */
// 25 Dec 2025 | 7:30 PM – 9:00 PM IST
const EXAM_START_TIME = new Date("2025-12-25T23:30:00+05:30");
const EXAM_END_TIME   = new Date("2025-12-26T23:00:00+05:30");

/* ================== IMPORTS ================== */
require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const mongoose = require("mongoose");
const session = require("express-session");
const path = require("path");
const { Parser } = require("json2csv");





/* ================== APP SETUP ================== */
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

/* ================== MIDDLEWARE ================== */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }
  })
);

/* ================== MONGODB CONNECT ================== */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB Connection Failed:", err);
    process.exit(1);
  });

/* ================== SCHEMAS ================== */
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  phone: String,
  college: String,
  attempted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const ResultSchema = new mongoose.Schema({
  email: String,
  answers: Array,
  submittedAt: { type: Date, default: Date.now }
});

const LogSchema = new mongoose.Schema({
  email: String,
  name: String,
  logs: Array
});

const User = mongoose.model("User", UserSchema);
const Result = mongoose.model("Result", ResultSchema);
const ExamLog = mongoose.model("ExamLog", LogSchema);

/* ================== FILE UPLOADS ================== */
const upload = multer({
  dest: "recordings/",
  limits: { fileSize: 200 * 1024 * 1024 }
});

/* ================== EXAM TIME GUARD ================== */
function examTimeCheck(req, res, next) {
  const now = new Date();

  if (now < EXAM_START_TIME)
    return res.status(403).json({ error: "⏳ Exam has not started yet" });

  if (now > EXAM_END_TIME)
    return res.status(403).json({ error: "⛔ Exam has ended" });

  next();
}

/* ================== LOGIN ================== */
app.post("/login", async (req, res) => {

  try {
    let { name, email, phone, college } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    email = email.trim().toLowerCase();

    let user = await User.findOne({ email });

    if (user && user.attempted)
      return res.status(403).json({ error: "You have already attempted this exam" });

    if (!user) {
      await User.create({ name, email, phone, college });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ================== PROCTORING LOGS ================== */
app.post("/log", async (req, res) => {
  try {
    const { candidate, email, type } = req.body;
    if (!email || !type) return res.sendStatus(400);

    await ExamLog.updateOne(
      { email },
      { $push: { logs: { type, time: new Date() } }, $setOnInsert: { name: candidate } },
      { upsert: true }
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("Log error:", err);
    res.sendStatus(500);
  }
});

/* ================== SUBMIT EXAM ================== */
app.post("/submit", examTimeCheck, async (req, res) => {

  try {
    let { email, answers } = req.body;
    email = email.trim().toLowerCase();

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: "No answers received" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    if (user.attempted)
      return res.status(403).json({ error: "Already submitted" });

    await Result.create({ email, answers });
    user.attempted = true;
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({ error: "Submission failed" });
  }
});


/* ================== ADMIN AUTH ================== */
const ADMIN_EMAIL = "admin@zwifty.com";
const ADMIN_PASSWORD = "Zwifty@123";

app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false });
});

function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.status(403).json({ error: "Unauthorized" });
}

/* ================== ADMIN RESULTS ================== */
app.get("/admin/results", requireAdmin, async (req, res) => {
  const results = await Result.find().sort({ submittedAt: -1 });
  res.json(results);
});

/* ================== CSV EXPORT ================== */
app.get("/admin/export-results", requireAdmin, async (req, res) => {
  const data = await Result.find();
  const parser = new Parser({ fields: ["email", "submittedAt", "answers"] });
  const csv = parser.parse(data);

  res.header("Content-Type", "text/csv");
  res.attachment("zwifty_exam_results.csv");
  res.send(csv);
});

/* ================== SOCKET.IO ================== */
io.on("connection", socket => {
  socket.on("violation", data => {
    socket.broadcast.emit("violation", data);
  });
});

/* ================== VERSION ================== */
app.get("/__version", (req, res) => {
  res.json({
    version: "ZWIFTY-MONGODB-FINAL-25DEC",
    time: new Date().toISOString()
  });
});

/* ================== START SERVER ================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("✅ Zwifty Exam Server Started");
  console.log("⏱️ Exam Window:");
  console.log("   Start:", EXAM_START_TIME.toString());
  console.log("   End  :", EXAM_END_TIME.toString());
});








