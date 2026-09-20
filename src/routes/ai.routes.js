const express = require("express");
const { body, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");
const { authenticate } = require("../middleware/auth");
const { anonymizeMahasiswa, guardPromptInjection } = require("../middleware/sanitize");
const { analyzeAttendance, generateDailySummary } = require("../services/gemini.service");

const router = express.Router();

// Semua route AI membutuhkan autentikasi
router.use(authenticate);

// ─── POST /api/ai/analyze ─────────────────────────────────────────────────────
// Analisis pola kehadiran mahasiswa dengan Gemini AI
const analyzeValidation = [
  body("startDate").isISO8601().withMessage("startDate harus format YYYY-MM-DD"),
  body("endDate").isISO8601().withMessage("endDate harus format YYYY-MM-DD"),
  body("reportType")
    .optional()
    .isIn(["daily", "weekly", "monthly"])
    .withMessage("reportType harus: daily, weekly, atau monthly"),
  body("notes").optional().isString(),
];

router.post("/analyze", analyzeValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { startDate, endDate, reportType = "weekly", notes = "" } = req.body;

  // Guard: cek prompt injection pada field notes (user-controlled)
  if (notes) {
    const guard = guardPromptInjection(notes);
    if (!guard.safe) {
      return res.status(400).json({ success: false, message: guard.reason });
    }
  }

  try {
    // 1. Ambil data kehadiran dari DB
    const records = await prisma.attendance.findMany({
      where: {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      include: {
        mahasiswa: {
          select: { nim: true, name: true, jurusan: true, semester: true },
        },
      },
      orderBy: { date: "asc" },
    });

    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Tidak ada data kehadiran untuk periode ${startDate} - ${endDate}.`,
      });
    }

    // 2. Anonimkan data sebelum dikirim ke AI (hapus NIM & nama asli)
    const { anonymized } = anonymizeMahasiswa(records);

    // 3. Panggil Gemini AI
    const aiResult = await analyzeAttendance(anonymized, reportType, { startDate, endDate });

    // 4. Cache hasil ke database
    const report = await prisma.aiReport.create({
      data: {
        reportType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        prompt: `${reportType} analysis: ${startDate} to ${endDate}`,
        result: aiResult,
      },
    });

    return res.json({
      success: true,
      data: {
        reportId: report.id,
        period: { startDate, endDate },
        reportType,
        totalRecords: records.length,
        analysis: aiResult,
      },
    });
  } catch (err) {
    console.error("[AI] /analyze error:", err);

    // Cek apakah error dari Gemini API (API key belum diisi, dll)
    if (err.message?.includes("API_KEY") || err.message?.includes("apiKey")) {
      return res.status(503).json({
        success: false,
        message: "Gemini API Key belum dikonfigurasi. Tambahkan GEMINI_API_KEY di file .env backend.",
      });
    }

    return res.status(500).json({ success: false, message: "Terjadi kesalahan saat menghubungi AI." });
  }
});

// ─── POST /api/ai/summary ─────────────────────────────────────────────────────
// Ringkasan harian singkat dari AI
router.post("/summary", async (req, res) => {
  const { date } = req.body;
  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0);

  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  try {
    // Hitung statistik hari ini
    const [total, statusCounts] = await Promise.all([
      prisma.mahasiswa.count(),
      prisma.attendance.groupBy({
        by: ["status"],
        where: { date: { gte: targetDate, lt: nextDay } },
        _count: { status: true },
      }),
    ]);

    const stats = { present: 0, late: 0, absent: 0, total };
    statusCounts.forEach((s) => {
      if (s.status === "PRESENT") stats.present = s._count.status;
      if (s.status === "LATE") stats.late = s._count.status;
      if (s.status === "ABSENT") stats.absent = s._count.status;
    });

    const dateStr = targetDate.toISOString().split("T")[0];
    const summary = await generateDailySummary(stats, dateStr);

    return res.json({
      success: true,
      data: { date: dateStr, stats, summary },
    });
  } catch (err) {
    console.error("[AI] /summary error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan saat menghasilkan ringkasan." });
  }
});

// ─── GET /api/ai/reports ──────────────────────────────────────────────────────
// Riwayat laporan AI yang sudah pernah dibuat
router.get("/reports", async (req, res) => {
  try {
    const reports = await prisma.aiReport.findMany({
      orderBy: { generatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        reportType: true,
        startDate: true,
        endDate: true,
        generatedAt: true,
      },
    });

    return res.json({ success: true, data: reports });
  } catch (err) {
    console.error("[AI] /reports error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── GET /api/ai/reports/:id ──────────────────────────────────────────────────
router.get("/reports/:id", async (req, res) => {
  try {
    const report = await prisma.aiReport.findUnique({ where: { id: req.params.id } });
    if (!report) {
      return res.status(404).json({ success: false, message: "Laporan tidak ditemukan." });
    }
    return res.json({ success: true, data: report });
  } catch (err) {
    console.error("[AI] /reports/:id error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

module.exports = router;
