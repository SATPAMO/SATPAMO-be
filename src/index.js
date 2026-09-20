require("dotenv").config();
const express = require("express");
const cors = require("cors");

// ─── Import Routes ────────────────────────────────────────────────────────────
const authRoutes       = require("./routes/auth.routes");
const mahasiswaRoutes  = require("./routes/mahasiswa.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const aiRoutes         = require("./routes/ai.routes");

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware Global ────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== "production";
app.use(cors({
  origin: isDev
    ? true
    : [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:3000",
      ],
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Request Logger (dev only) ────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth",       authRoutes);
app.use("/api/mahasiswa",  mahasiswaRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/ai",         aiRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    service: "SAMA Backend",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Endpoint tidak ditemukan." });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Terjadi kesalahan internal server.",
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 SAMA Backend berjalan di http://localhost:${PORT} (0.0.0.0)`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔑 Gemini AI: ${process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here" ? "✅ Configured" : "⚠️  Belum dikonfigurasi (isi GEMINI_API_KEY di .env)"}\n`);
});

module.exports = app;
