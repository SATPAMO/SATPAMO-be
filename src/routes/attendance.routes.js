const express = require("express");
const { body, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

const { validateLocation } = require("../lib/geofence");
const { verifySelfieWithGemini } = require("../services/gemini.service");

// â”€â”€â”€ POST /api/attendance/check-in â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Presensi mandiri mahasiswa dengan Selfie + Lokasi GPS (Publik, tanpa wajib login Dosen)
const checkInValidation = [
  body("mahasiswaId").notEmpty().withMessage("mahasiswaId wajib diisi"),
  body("photo").notEmpty().withMessage("Foto selfie wajib disertakan"),
  body("latitude").isFloat().withMessage("Latitude harus berupa angka"),
  body("longitude").isFloat().withMessage("Longitude harus berupa angka"),
  body("notes").optional().isString(),
];

router.post("/check-in", checkInValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { mahasiswaId, photo, latitude, longitude, notes } = req.body;

  try {
    // 1. Cek apakah mahasiswa terdaftar
    const mahasiswa = await prisma.mahasiswa.findUnique({
      where: { id: mahasiswaId },
    });

    if (!mahasiswa) {
      return res.status(404).json({
        success: false,
        message: "Data mahasiswa tidak ditemukan.",
      });
    }

    // 2. Tentukan tanggal hari ini (berdasarkan WIB)
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
    const todayDate = new Date(`${dateStr}T00:00:00.000Z`);

    // 3. Validasi Lokasi (Geofencing Kampus)
    const geoResult = validateLocation(parseFloat(latitude), parseFloat(longitude));

    // 4. Verifikasi Foto Selfie dengan Gemini AI Vision
    const aiResult = await verifySelfieWithGemini(photo);

    // 5. Tentukan Status Kehadiran
    // Waktu toleransi jam masuk (batas jam 08:15 WIB, timezone-aware)
    const timeParts = new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(now);
    const currentHourWIB = parseInt(timeParts.find((p) => p.type === "hour")?.value || "0", 10);
    const currentMinuteWIB = parseInt(timeParts.find((p) => p.type === "minute")?.value || "0", 10);
    const isPastCutoff = currentHourWIB > 8 || (currentHourWIB === 8 && currentMinuteWIB > 15);

    let status = "PRESENT";
    if (aiResult.verdict === "REJECTED") {
      status = "ABSENT";
    } else if (isPastCutoff) {
      status = "LATE";
    }

    const noteDetails = [];
    if (notes) noteDetails.push(notes);
    if (!geoResult.isValid) {
      noteDetails.push(`[Geofence] Di luar radius kampus (${geoResult.distance}m)`);
    }
    if (aiResult.verdict !== "VERIFIED") {
      noteDetails.push(`[AI] ${aiResult.reason}`);
    }

    // 6. Simpan atau perbarui record kehadiran
    const record = await prisma.attendance.upsert({
      where: {
        mahasiswaId_date: {
          mahasiswaId,
          date: todayDate,
        },
      },
      update: {
        checkIn: now,
        status,
        photo,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        distance: geoResult.distance,
        isLocationValid: geoResult.isValid,
        aiVerification: aiResult,
        notes: noteDetails.join(" | ") || null,
      },
      create: {
        mahasiswaId,
        date: todayDate,
        checkIn: now,
        status,
        photo,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        distance: geoResult.distance,
        isLocationValid: geoResult.isValid,
        aiVerification: aiResult,
        notes: noteDetails.join(" | ") || null,
      },
      include: {
        mahasiswa: { select: { nim: true, name: true, jurusan: true, semester: true } },
      },
    });

    return res.status(201).json({
      success: true,
      message: geoResult.isValid && aiResult.verdict === "VERIFIED"
        ? "Presensi berhasil diverifikasi dan dicatat!"
        : "Presensi dicatat dengan catatan verifikasi.",
      data: formatRecord(record),
      verification: {
        location: geoResult,
        ai: aiResult,
      },
    });
  } catch (err) {
    console.error("[ATTENDANCE] Check-in error:", err);
    return res.status(500).json({ success: false, message: "Gagal memproses presensi: " + err.message });
  }
});

// Semua route di bawah ini membutuhkan autentikasi Dosen/Admin
router.use(authenticate);

// â”€â”€â”€ Helper: format attendance record untuk response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatRecord(record) {
  return {
    id: record.id,
    mahasiswaId: record.mahasiswaId,
    nim: record.mahasiswa?.nim,
    name: record.mahasiswa?.name,
    jurusan: record.mahasiswa?.jurusan,
    semester: record.mahasiswa?.semester,
    date: record.date,
    checkIn: record.checkIn,
    checkOut: record.checkOut,
    status: record.status,
    notes: record.notes,
    photo: record.photo,
    latitude: record.latitude,
    longitude: record.longitude,
    distance: record.distance,
    isLocationValid: record.isLocationValid,
    aiVerification: record.aiVerification,
  };
}

// â”€â”€â”€ GET /api/attendance/stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Harus didefinisikan SEBELUM /:id agar tidak terjadi konflik routing
router.get("/stats", async (req, res) => {
  const dateParam = req.query.date;
  const todayWIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const targetDateStr = (dateParam && dateParam !== "undefined") ? dateParam : todayWIB;
  const targetDate = new Date(`${targetDateStr}T00:00:00.000Z`);

  try {
    const [totalMahasiswa, statusCounts] = await Promise.all([
      prisma.mahasiswa.count(),
      prisma.attendance.groupBy({
        by: ["status"],
        where: {
          date: targetDate,
        },
        _count: { status: true },
      }),
    ]);

    const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, IZIN: 0 };
    statusCounts.forEach((s) => {
      counts[s.status] = s._count.status;
    });

    return res.json({
      success: true,
      data: {
        date: targetDateStr,
        total: totalMahasiswa,
        present: counts.PRESENT,
        late: counts.LATE,
        absent: counts.ABSENT,
        izin: counts.IZIN,
        notRecorded: totalMahasiswa - counts.PRESENT - counts.LATE - counts.ABSENT - counts.IZIN,
      },
    });
  } catch (err) {
    console.error("[ATTENDANCE] GET /stats error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// â”€â”€â”€ GET /api/attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Query: ?date=2026-09-07&startDate=...&endDate=...&status=PRESENT&search=budi
router.get("/", async (req, res) => {
  const { date, startDate, endDate, status, search, page = 1, limit = 50 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Bersihkan search dari string undefined / spasi kosong
  const cleanSearch = (search && search !== "undefined" && search.trim() !== "")
    ? search.trim()
    : undefined;

  // Build date filter (timezone-aware WIB)
  let dateFilter = {};
  if (date && date !== "undefined") {
    dateFilter = { date: new Date(`${date}T00:00:00.000Z`) };
  } else if (startDate && endDate && startDate !== "undefined" && endDate !== "undefined") {
    dateFilter = {
      date: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T00:00:00.000Z`),
      },
    };
  } else {
    // Default: hari ini (WIB)
    const todayWIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    dateFilter = { date: new Date(`${todayWIB}T00:00:00.000Z`) };
  }

  try {
    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          ...dateFilter,
          ...(status ? { status } : {}),
          ...(cleanSearch
            ? {
                mahasiswa: {
                  OR: [
                    { name: { contains: cleanSearch } },
                    { nim: { contains: cleanSearch } },
                  ],
                },
              }
            : {}),
        },
        include: {
          mahasiswa: { select: { nim: true, name: true, jurusan: true, semester: true } },
        },
        orderBy: [{ date: "desc" }, { checkIn: "desc" }, { createdAt: "desc" }],
        skip,
        take: parseInt(limit),
      }),
      prisma.attendance.count({
        where: {
          ...dateFilter,
          ...(status ? { status } : {}),
        },
      }),
    ]);

    return res.json({
      success: true,
      data: records.map(formatRecord),
      pagination: { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    console.error("[ATTENDANCE] GET / error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// â”€â”€â”€ POST /api/attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const createValidation = [
  body("mahasiswaId").notEmpty().withMessage("mahasiswaId wajib diisi"),
  body("date").isISO8601().withMessage("Format tanggal tidak valid (YYYY-MM-DD)"),
  body("status")
    .isIn(["PRESENT", "LATE", "ABSENT", "IZIN"])
    .withMessage("Status harus PRESENT, LATE, ABSENT, atau IZIN"),
  body("checkIn").optional().isISO8601(),
  body("checkOut").optional().isISO8601(),
];

router.post("/", createValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { mahasiswaId, date, checkIn, checkOut, status, notes } = req.body;

  try {
    const record = await prisma.attendance.upsert({
      where: {
        mahasiswaId_date: {
          mahasiswaId,
          date: new Date(date),
        },
      },
      update: {
        checkIn: checkIn ? new Date(checkIn) : undefined,
        checkOut: checkOut ? new Date(checkOut) : undefined,
        status,
        notes,
      },
      create: {
        mahasiswaId,
        date: new Date(date),
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        status,
        notes,
      },
      include: {
        mahasiswa: { select: { nim: true, name: true, jurusan: true, semester: true } },
      },
    });

    return res.status(201).json({
      success: true,
      message: "Kehadiran berhasil dicatat.",
      data: formatRecord(record),
    });
  } catch (err) {
    console.error("[ATTENDANCE] POST / error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// â”€â”€â”€ PUT /api/attendance/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put("/:id", async (req, res) => {
  const { checkIn, checkOut, status, notes } = req.body;

  try {
    const record = await prisma.attendance.update({
      where: { id: req.params.id },
      data: {
        ...(checkIn !== undefined && { checkIn: checkIn ? new Date(checkIn) : null }),
        ...(checkOut !== undefined && { checkOut: checkOut ? new Date(checkOut) : null }),
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        mahasiswa: { select: { nim: true, name: true, jurusan: true, semester: true } },
      },
    });

    return res.json({
      success: true,
      message: "Kehadiran berhasil diperbarui.",
      data: formatRecord(record),
    });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, message: "Record tidak ditemukan." });
    }
    console.error("[ATTENDANCE] PUT /:id error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// â”€â”€â”€ DELETE /api/attendance/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.delete("/:id", async (req, res) => {
  try {
    await prisma.attendance.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Record kehadiran dihapus." });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, message: "Record tidak ditemukan." });
    }
    console.error("[ATTENDANCE] DELETE /:id error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

module.exports = router;
