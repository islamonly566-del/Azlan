
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const UPLOADS = path.join(ROOT, "uploads");
const DB = path.join(ROOT, "videos.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error("Set ADMIN_PASSWORD to a password of at least 12 characters.");
  process.exit(1);
}

fs.mkdirSync(PUBLIC, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

if (!fs.existsSync(DB)) {
  fs.writeFileSync(DB, "[]");
}

app.use(express.json({ limit: "20kb" }));
app.use(express.static(PUBLIC));

function readVideos() {
  return JSON.parse(fs.readFileSync(DB, "utf8"));
}

function saveVideos(videos) {
  fs.writeFileSync(DB, JSON.stringify(videos, null, 2));
}

function adminOnly(req, res, next) {
  const supplied = req.get("x-admin-password") || "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_PASSWORD);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Admin login required" });
  }
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => {
    cb(null, crypto.randomUUID() + ".mp4");
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "video/mp4") {
      return cb(new Error("Only MP4 videos are accepted"));
    }
    cb(null, true);
  }
});

app.get("/api/videos", (req, res) => {
  const videos = readVideos()
    .filter(v => v.status === "approved")
    .map(v => ({
      id: v.id,
      title: v.title,
      url: "/videos/" + v.filename
    }));

  res.json(videos);
});

app.post("/api/upload", (req, res, next) => {
  upload.single("video")(req, res, err => {
    if (err) return next(err);

    if (!req.file) {
      return res.status(400).json({ error: "Choose an MP4 video" });
    }

    const title = String(req.body.title || "My video").slice(0, 100);
    const videos = readVideos();

    videos.push({
      id: crypto.randomUUID(),
      filename: req.file.filename,
      title,
      status: "pending"
    });

    saveVideos(videos);
    res.json({ message: "Video submitted for admin approval" });
  });
});

app.get("/api/admin/pending", adminOnly, (req, res) => {
  res.json(readVideos().filter(v => v.status === "pending"));
});

app.post("/api/admin/:id/approve", adminOnly, (req, res) => {
  const videos = readVideos();
  const video = videos.find(v => v.id === req.params.id);

  if (!video || video.status !== "pending") {
    return res.status(404).json({ error: "Pending video not found" });
  }

  video.status = "approved";
  saveVideos(videos);
  res.json({ message: "Video approved" });
});

app.delete("/api/admin/:id", adminOnly, (req, res) => {
  const videos = readVideos();
  const index = videos.findIndex(v => v.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: "Video not found" });
  }

  const [video] = videos.splice(index, 1);
  const filename = path.basename(video.filename);
  const file = path.join(UPLOADS, filename);

  if (fs.existsSync(file)) fs.unlinkSync(file);
  saveVideos(videos);

  res.json({ message: "Video deleted" });
});

app.get("/videos/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const video = readVideos().find(
    v => v.filename === filename && v.status === "approved"
  );

  if (!video) return res.sendStatus(404);

  res.sendFile(path.join(UPLOADS, filename));
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(400).json({ error: err.message || "Request failed" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log("Website: http://127.0.0.1:" + PORT);
});
