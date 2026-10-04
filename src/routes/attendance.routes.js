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
  body("kelasId").optional().isString(),
  body("pertemuanKe").optional().isInt(),
];

router.post("/check-in", checkInValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { mahasiswaId, photo, latitude, longitude, notes, kelasId, pertemuanKe } = req.body;

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
    const existing = await prisma.attendance.findFirst({
      where: {
        mahasiswaId,
        date: todayDate,
        ...(kelasId ? { kelasId } : { kelasId: null }),
      },
    });

    const attendancePayload = {
      mahasiswaId,
      kelasId: kelasId || null,
      pertemuanKe: pertemuanKe ? parseInt(pertemuanKe) : null,
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
    };

    let record;
    if (existing) {
      record = await prisma.attendance.update({
        where: { id: existing.id },
        data: attendancePayload,
        include: {
          mahasiswa: { select: { nim: true, name: true, jurusan: true, semester: true } },
          kelas: { select: { id: true, kode: true, nama: true } },
        },
      });
    } else {
      record = await prisma.attendance.create({
        data: attendancePayload,
        include: {
          mahasiswa: { select: { nim: true, name: true, jurusan: true, semester: true } },
          kelas: { select: { id: true, kode: true, nama: true } },
        },
      });
    }

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

// ─── Helper: format attendance record untuk response ──────────────────────────
function formatRecord(record) {
  return {
    id: record.id,
    mahasiswaId: record.mahasiswaId,
    kelasId: record.kelasId || null,
    kelas: record.kelas ? { id: record.kelas.id, kode: record.kelas.kode, nama: record.kelas.nama } : null,
    nim: record.mahasiswa?.nim,
    name: record.mahasiswa?.name,
    jurusan: record.mahasiswa?.jurusan,
    semester: record.mahasiswa?.semester,
    date: record.date,
    checkIn: record.checkIn,
    checkOut: record.checkOut,
    status: record.status,
    pertemuanKe: record.pertemuanKe || null,
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

// ─── GET /api/attendance ───────────────────────────────────────────────────────
// Query: ?date=2026-09-07&startDate=...&endDate=...&status=PRESENT&search=budi&kelasId=...
router.get("/", async (req, res) => {
  const { date, startDate, endDate, status, search, kelasId, page = 1, limit = 50 } = req.query;

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
    const where = {
      ...dateFilter,
      ...(status ? { status } : {}),
      ...(kelasId && kelasId !== "undefined" ? { kelasId } : {}),
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
    };

    const [records, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        include: {
          mahasiswa: { select: { nim: true, name: true, jurusan: true, semester: true } },
          kelas: { select: { id: true, kode: true, nama: true } },
        },
        orderBy: [{ date: "desc" }, { checkIn: "desc" }, { createdAt: "desc" }],
        skip,
        take: parseInt(limit),
      }),
      prisma.attendance.count({
        where,
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

// ═══════════════════════════════════════════════════════════════════════════════
// ABSENSI BERBASIS KELAS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/attendance/kelas/:kelasId ───────────────────────────────────────
// Dosen melihat daftar seluruh mahasiswa di kelas beserta status absensi untuk tanggal/pertemuan
router.get("/kelas/:kelasId", async (req, res) => {
  const { kelasId } = req.params;
  const { date, pertemuanKe } = req.query;

  try {
    const kelas = await prisma.kelas.findUnique({
      where: { id: kelasId },
      include: {
        dosen: { select: { id: true, username: true, email: true } },
        jadwals: true,
      },
    });

    if (!kelas) {
      return res.status(404).json({ success: false, message: "Kelas tidak ditemukan." });
    }

    if (req.user.role !== "ADMIN" && kelas.dosenId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Anda tidak memiliki hak akses ke kelas ini." });
    }

    // Tentukan tanggal target (WIB)
    const todayWIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const targetDateStr = date && date !== "undefined" ? date : todayWIB;
    const targetDate = new Date(`${targetDateStr}T00:00:00.000Z`);

    // 1. Ambil semua mahasiswa yang terdaftar di kelas
    const enrolledMembers = await prisma.kelasMahasiswa.findMany({
      where: { kelasId },
      include: {
        mahasiswa: {
          select: {
            id: true,
            nim: true,
            name: true,
            email: true,
            jurusan: true,
            semester: true,
          },
        },
      },
      orderBy: { mahasiswa: { name: "asc" } },
    });

    // 2. Ambil catatan kehadiran untuk kelas dan tanggal (atau pertemuanKe)
    const attendanceFilter = {
      kelasId,
      ...(pertemuanKe ? { pertemuanKe: parseInt(pertemuanKe) } : { date: targetDate }),
    };

    const attendances = await prisma.attendance.findMany({
      where: attendanceFilter,
    });

    const attendanceMap = new Map();
    attendances.forEach((att) => {
      attendanceMap.set(att.mahasiswaId, att);
    });

    // 3. Gabungkan seluruh anggota dengan catatan kehadirannya
    const roster = enrolledMembers.map((em) => {
      const att = attendanceMap.get(em.mahasiswa.id);
      return {
        mahasiswaId: em.mahasiswa.id,
        nim: em.mahasiswa.nim,
        name: em.mahasiswa.name,
        jurusan: em.mahasiswa.jurusan,
        semester: em.mahasiswa.semester,
        attendanceId: att ? att.id : null,
        status: att ? att.status : "NOT_RECORDED",
        checkIn: att ? att.checkIn : null,
        checkOut: att ? att.checkOut : null,
        notes: att ? att.notes : null,
        photo: att ? att.photo : null,
        latitude: att ? att.latitude : null,
        longitude: att ? att.longitude : null,
        distance: att ? att.distance : null,
        isLocationValid: att ? att.isLocationValid : false,
        pertemuanKe: att ? att.pertemuanKe : (pertemuanKe ? parseInt(pertemuanKe) : null),
      };
    });

    const stats = {
      totalEnrolled: roster.length,
      present: roster.filter((r) => r.status === "PRESENT").length,
      late: roster.filter((r) => r.status === "LATE").length,
      absent: roster.filter((r) => r.status === "ABSENT").length,
      izin: roster.filter((r) => r.status === "IZIN").length,
      sakit: roster.filter((r) => r.status === "SAKIT").length,
      notRecorded: roster.filter((r) => r.status === "NOT_RECORDED").length,
    };

    return res.json({
      success: true,
      kelas: {
        id: kelas.id,
        kode: kelas.kode,
        nama: kelas.nama,
        dosen: kelas.dosen,
        jadwals: kelas.jadwals,
      },
      filter: {
        date: targetDateStr,
        pertemuanKe: pertemuanKe ? parseInt(pertemuanKe) : null,
      },
      stats,
      students: roster,
      data: roster,
    });
  } catch (err) {
    console.error("[ATTENDANCE] GET /kelas/:kelasId error:", err);
    return res.status(500).json({ success: false, message: "Gagal memuat absensi kelas: " + err.message });
  }
});

// ─── POST /api/attendance/kelas/:kelasId/record ───────────────────────────────
// Dosen mencatat / mengupdate absensi mahasiswa di kelas (mendukung input batch satu kelas)
router.post("/kelas/:kelasId/record", async (req, res) => {
  const { kelasId } = req.params;
  const { date, pertemuanKe, records, mahasiswaId, status, notes } = req.body;

  try {
    const kelas = await prisma.kelas.findUnique({
      where: { id: kelasId },
    });

    if (!kelas) {
      return res.status(404).json({ success: false, message: "Kelas tidak ditemukan." });
    }

    if (req.user.role !== "ADMIN" && kelas.dosenId !== req.user.id) {
      return res.status(403).json({ success: false, message: "Anda tidak memiliki hak akses ke kelas ini." });
    }

    const todayWIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const targetDateStr = date && date !== "undefined" ? date : todayWIB;
    const targetDate = new Date(`${targetDateStr}T00:00:00.000Z`);
    const targetPertemuan = pertemuanKe ? parseInt(pertemuanKe) : null;

    let itemsToProcess = [];
    if (Array.isArray(records) && records.length > 0) {
      itemsToProcess = records;
    } else if (mahasiswaId && status) {
      itemsToProcess = [{ mahasiswaId, status, notes }];
    } else {
      return res.status(400).json({
        success: false,
        message: "Wajib mengirimkan array 'records' atau pasangan 'mahasiswaId' & 'status'.",
      });
    }

    const validStatuses = ["PRESENT", "LATE", "ABSENT", "IZIN", "SAKIT"];
    const now = new Date();
    const results = [];

    for (const item of itemsToProcess) {
      if (!item.mahasiswaId) continue;
      const attStatus = validStatuses.includes(item.status) ? item.status : "PRESENT";

      const existing = await prisma.attendance.findFirst({
        where: {
          mahasiswaId: item.mahasiswaId,
          kelasId,
          ...(targetPertemuan !== null ? { pertemuanKe: targetPertemuan } : { date: targetDate }),
        },
      });

      if (existing) {
        const updated = await prisma.attendance.update({
          where: { id: existing.id },
          data: {
            status: attStatus,
            pertemuanKe: targetPertemuan !== null ? targetPertemuan : existing.pertemuanKe,
            date: targetDate,
            checkIn: attStatus === "PRESENT" || attStatus === "LATE" ? (existing.checkIn || now) : null,
            notes: item.notes !== undefined ? item.notes : existing.notes,
          },
          include: {
            mahasiswa: { select: { nim: true, name: true } },
          },
        });
        results.push(updated);
      } else {
        const created = await prisma.attendance.create({
          data: {
            mahasiswaId: item.mahasiswaId,
            kelasId,
            pertemuanKe: targetPertemuan,
            date: targetDate,
            status: attStatus,
            checkIn: attStatus === "PRESENT" || attStatus === "LATE" ? now : null,
            notes: item.notes || null,
          },
          include: {
            mahasiswa: { select: { nim: true, name: true } },
          },
        });
        results.push(created);
      }
    }

    return res.json({
      success: true,
      message: `Berhasil mencatat absensi ${results.length} mahasiswa untuk kelas ${kelas.nama}.`,
      totalProcessed: results.length,
      data: results.map((r) => ({
        id: r.id,
        mahasiswaId: r.mahasiswaId,
        nim: r.mahasiswa?.nim,
        name: r.mahasiswa?.name,
        status: r.status,
        pertemuanKe: r.pertemuanKe,
        notes: r.notes,
      })),
    });
  } catch (err) {
    console.error("[ATTENDANCE] POST /kelas/:kelasId/record error:", err);
    return res.status(500).json({ success: false, message: "Gagal mencatat absensi kelas: " + err.message });
  }
});

module.exports = router;

