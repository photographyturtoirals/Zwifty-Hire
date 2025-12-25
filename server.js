/*************************************************
 * ZWIFTY INTERNSHIP EXAM – SERVER (FINAL)
 *************************************************/
console.log("🔥 LOGIN HIT - NEW CODE RUNNING");

/* ================== EXAM TIME CONFIG ================== */
const EXAM_START_TIME = new Date("2025-12-25T05:20:00+05:30");
const EXAM_END_TIME   = new Date("2025-12-25T07:00:00+05:30");

/* ================== IMPORTS ================== */
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const fs = require("fs");
const admin = require("./firebase");
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
    secret: "zwifty-admin-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }
  })
);

/* ================== FIRESTORE ================== */
const db = admin.firestore();

/* ================== FILE UPLOADS ================== */
const upload = multer({
  dest: "recordings/",
  limits: { fileSize: 200 * 1024 * 1024 }
});

const snapshotUpload = multer({
  storage: multer.memoryStorage()
});

/* ================== EXAM TIME GUARD ================== */
function examTimeCheck(req, res, next) {
  const now = new Date();

  if (now < EXAM_START_TIME) {
    return res.status(403).json({ error: "⏳ Exam has not started yet" });
  }

  if (now > EXAM_END_TIME) {
    return res.status(403).json({ error: "⛔ Exam has ended" });
  }

  next();
}

/* ================== CANDIDATE LOGIN ================== */
app.post("/login", examTimeCheck, async (req, res) => {
  try {
    let { name, email, phone, college } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    // ✅ FIX 1: Normalize email
    email = email.trim().toLowerCase();

    const ref = db.collection("users").doc(email);
    const snap = await ref.get();

    // ✅ FIX 2: Block ONLY if attempted === true
    if (snap.exists) {
      const data = snap.data();
      if (data && data.attempted === true) {
        return res.status(403).json({
          error: "You have already attempted this exam"
        });
      }
    }

    // ✅ FIX 3: Create user only if not exists
    if (!snap.exists) {
      await ref.set({
        name,
        email,
        phone,
        college,
        attempted: false,
        createdAt: new Date()
      });
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

    const safeEmail = email.trim().toLowerCase();

    await db.collection("exam_attempts").doc(safeEmail).set(
      {
        name: candidate,
        email: safeEmail,
        logs: admin.firestore.FieldValue.arrayUnion({
          type,
          time: new Date().toISOString()
        })
      },
      { merge: true }
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
    if (!email) return res.status(400).json({ error: "Email required" });

    // ✅ FIX 4: Normalize email
    email = email.trim().toLowerCase();

    const userRef = db.collection("users").doc(email);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(400).json({ error: "User not found" });
    }

    if (userSnap.data().attempted === true) {
      return res.status(403).json({ error: "Already submitted" });
    }

    await db.collection("results").doc(email).set({
      email,
      answers: answers || [],
      submittedAt: new Date()
    });

    await userRef.update({
      attempted: true
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({ error: "Submission failed" });
  }
});

/* ================== SNAPSHOT UPLOAD ================== */
app.post("/upload-snapshot", snapshotUpload.single("image"), async (req, res) => {
  try {
    let { email, reason } = req.body;
    if (!req.file || !email) return res.sendStatus(400);

    email = email.trim().toLowerCase();

    const bucket = admin.storage().bucket();
    const fileName = `snapshots/${email}_${Date.now()}.png`;

    await bucket.file(fileName).save(req.file.buffer, {
      metadata: { contentType: "image/png" }
    });

    await db.collection("snapshots").add({
      email,
      reason,
      path: fileName,
      time: new Date()
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("Snapshot error:", err);
    res.sendStatus(500);
  }
});

/* ================== SCREEN RECORDING ================== */
app.post("/upload-screen", upload.single("video"), (req, res) => {
  if (!req.file) return res.sendStatus(400);
  res.sendStatus(200);
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
  const snap = await db.collection("results").orderBy("submittedAt", "desc").get();
  res.json(snap.docs.map(d => d.data()));
});

/* ================== CSV EXPORT ================== */
app.get("/admin/export-results", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("results").get();
    const data = snap.docs.map(doc => doc.data());

    const parser = new Parser({
      fields: ["email", "submittedAt", "answers"]
    });

    const csv = parser.parse(data);
    res.header("Content-Type", "text/csv");
    res.attachment("zwifty_exam_results.csv");
    res.send(csv);
  } catch {
    res.status(500).send("CSV export failed");
  }
});

/* ================== SOCKET.IO ================== */
io.on("connection", socket => {
  socket.on("violation", data => {
    socket.broadcast.emit("violation", data);
  });
});
app.get("/__version", (req, res) => {
  res.json({
    version: "ZWIFTY-SERVER-NEW-DEPLOY-25DEC",
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


