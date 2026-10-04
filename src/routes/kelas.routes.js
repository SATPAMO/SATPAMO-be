const express = require("express");
const { body, param, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Semua route manajemen kelas membutuhkan autentikasi Dosen/Admin
router.use(authenticate);

// ─── Helper: Cek Otoritas Akses Kelas ──────────────────────────────────────────
async function checkKelasAccess(kelasId, user) {
  const kelas = await prisma.kelas.findUnique({
    where: { id: kelasId },
    include: { dosen: { select: { id: true, username: true, email: true } } },
  });

  if (!kelas) {
    return { error: { status: 404, message: "Kelas tidak ditemukan." } };
  }

  // Jika bukan ADMIN dan bukan Dosen pengampu kelas tersebut
  if (user.role !== "ADMIN" && kelas.dosenId !== user.id) {
    return {
      error: {
        status: 403,
        message: "Anda tidak memiliki hak akses untuk mengelola kelas ini.",
      },
    };
  }

  return { kelas };
}

// ─── GET /api/kelas ───────────────────────────────────────────────────────────
// Mengambil semua kelas milik dosen yang login (atau semua jika ADMIN)
router.get("/", async (req, res) => {
  try {
    const where = {};
    if (req.user.role !== "ADMIN") {
      where.dosenId = req.user.id;
    } else if (req.query.dosenId) {
      where.dosenId = req.query.dosenId;
    }

    const classes = await prisma.kelas.findMany({
      where,
      include: {
        dosen: { select: { id: true, username: true, email: true } },
        jadwals: true,
        _count: {
          select: {
            mahasiswas: true,
            attendances: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      success: true,
      data: classes.map((k) => ({
        id: k.id,
        kode: k.kode,
        nama: k.nama,
        deskripsi: k.deskripsi,
        dosen: k.dosen,
        jadwals: k.jadwals,
        totalMahasiswa: k._count.mahasiswas,
        totalPresensi: k._count.attendances,
        createdAt: k.createdAt,
      })),
    });
  } catch (err) {
    console.error("[KELAS] GET / error:", err);
    return res.status(500).json({ success: false, message: "Gagal memuat daftar kelas: " + err.message });
  }
});

// ─── GET /api/kelas/:id ───────────────────────────────────────────────────────
// Detail kelas lengkap: jadwal, mahasiswa terdaftar, statistik & absensi terkini
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { error, kelas } = await checkKelasAccess(id, req.user);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const detailKelas = await prisma.kelas.findUnique({
      where: { id },
      include: {
        dosen: { select: { id: true, username: true, email: true } },
        jadwals: {
          orderBy: { hari: "asc" },
        },
        mahasiswas: {
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
        },
        _count: {
          select: { attendances: true },
        },
      },
    });

    if (!detailKelas) {
      return res.status(404).json({ success: false, message: "Kelas tidak ditemukan." });
    }

    // 1. Ambil sesi absensi terkini di kelas ini
    const latestAttSession = await prisma.attendance.findFirst({
      where: { kelasId: id },
      orderBy: [
        { date: "desc" },
        { createdAt: "desc" },
      ],
      select: { date: true, pertemuanKe: true },
    });

    let latestAttendance = null;

    if (latestAttSession) {
      const sessionDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(latestAttSession.date);
      const sessionRecords = await prisma.attendance.findMany({
        where: {
          kelasId: id,
          ...(latestAttSession.pertemuanKe !== null && latestAttSession.pertemuanKe !== undefined
            ? { pertemuanKe: latestAttSession.pertemuanKe }
            : { date: latestAttSession.date }),
        },
      });

      const attMap = new Map();
      sessionRecords.forEach((att) => {
        attMap.set(att.mahasiswaId, att);
      });

      const records = detailKelas.mahasiswas.map((km) => {
        const att = attMap.get(km.mahasiswa.id);
        return {
          id: km.mahasiswa.id,
          mahasiswaId: km.mahasiswa.id,
          nim: km.mahasiswa.nim,
          name: km.mahasiswa.name,
          jurusan: km.mahasiswa.jurusan,
          semester: km.mahasiswa.semester,
          attendanceId: att ? att.id : null,
          status: att ? att.status : "NOT_RECORDED",
          checkIn: att ? att.checkIn : null,
          photo: att ? att.photo : null,
          notes: att ? att.notes : null,
          isLocationValid: att ? att.isLocationValid : false,
          pertemuanKe: att?.pertemuanKe ?? latestAttSession.pertemuanKe ?? 1,
        };
      });

      latestAttendance = {
        date: sessionDateStr,
        pertemuanKe: latestAttSession.pertemuanKe ?? 1,
        stats: {
          total: records.length,
          present: records.filter((r) => r.status === "PRESENT").length,
          late: records.filter((r) => r.status === "LATE").length,
          absent: records.filter((r) => r.status === "ABSENT").length,
          izin: records.filter((r) => r.status === "IZIN").length,
          sakit: records.filter((r) => r.status === "SAKIT").length,
          notRecorded: records.filter((r) => r.status === "NOT_RECORDED").length,
        },
        records,
      };
    }

    // 2. Hitung statistik kehadiran per mahasiswa di kelas ini
    const studentAttCounts = await prisma.attendance.groupBy({
      by: ["mahasiswaId", "status"],
      where: { kelasId: id },
      _count: { _all: true },
    });

    const countMap = new Map();
    studentAttCounts.forEach((c) => {
      if (!countMap.has(c.mahasiswaId)) {
        countMap.set(c.mahasiswaId, { present: 0, late: 0, absent: 0, izin: 0, sakit: 0, total: 0 });
      }
      const entry = countMap.get(c.mahasiswaId);
      const cnt = c._count._all;
      if (c.status === "PRESENT") entry.present += cnt;
      else if (c.status === "LATE") entry.late += cnt;
      else if (c.status === "ABSENT") entry.absent += cnt;
      else if (c.status === "IZIN") entry.izin += cnt;
      else if (c.status === "SAKIT") entry.sakit += cnt;
      entry.total += cnt;
    });

    const enrichedMahasiswas = detailKelas.mahasiswas.map((km) => {
      const stStats = countMap.get(km.mahasiswa.id) || { present: 0, late: 0, absent: 0, izin: 0, sakit: 0, total: 0 };
      const latestStatus = latestAttendance?.records?.find((r) => r.mahasiswaId === km.mahasiswa.id)?.status || "NOT_RECORDED";
      return {
        ...km.mahasiswa,
        enrolledAt: km.enrolledAt,
        attendanceStats: stStats,
        hadirCount: stStats.present + stStats.late,
        latestStatus,
      };
    });

    return res.json({
      success: true,
      data: {
        id: detailKelas.id,
        kode: detailKelas.kode,
        nama: detailKelas.nama,
        deskripsi: detailKelas.deskripsi,
        dosen: detailKelas.dosen,
        jadwal: detailKelas.jadwals,
        jadwals: detailKelas.jadwals,
        totalMahasiswa: detailKelas.mahasiswas.length,
        totalPresensi: detailKelas._count.attendances,
        mahasiswa: enrichedMahasiswas,
        mahasiswaList: enrichedMahasiswas,
        latestAttendance,
        createdAt: detailKelas.createdAt,
      },
    });
  } catch (err) {
    console.error("[KELAS] GET /:id error:", err);
    return res.status(500).json({ success: false, message: "Gagal memuat detail kelas: " + err.message });
  }
});

// ─── POST /api/kelas ──────────────────────────────────────────────────────────
// Dosen membuat kelas baru
router.post(
  "/",
  [
    body("kode").trim().notEmpty().withMessage("Kode kelas wajib diisi"),
    body("nama").trim().notEmpty().withMessage("Nama kelas/mata kuliah wajib diisi"),
    body("deskripsi").optional().trim(),
    body("jadwals").optional().isArray().withMessage("Jadwals harus berupa array"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { kode, nama, deskripsi, jadwals, dosenId } = req.body;
    const targetDosenId = req.user.role === "ADMIN" && dosenId ? dosenId : req.user.id;

    try {
      // Cek apakah kode sudah dipakai
      const existing = await prisma.kelas.findUnique({ where: { kode } });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Kode kelas '${kode}' sudah digunakan. Gunakan kode lain.`,
        });
      }

      // Buat kelas beserta jadwal (jika ada) dalam transaksi
      const newClass = await prisma.$transaction(async (tx) => {
        const created = await tx.kelas.create({
          data: {
            kode,
            nama,
            deskripsi: deskripsi || null,
            dosenId: targetDosenId,
          },
        });

        if (Array.isArray(jadwals) && jadwals.length > 0) {
          const jadwalData = jadwals.map((j) => ({
            kelasId: created.id,
            hari: j.hari,
            jamMulai: j.jamMulai,
            jamSelesai: j.jamSelesai,
            ruangan: j.ruangan || null,
          }));

          await tx.jadwalKelas.createMany({
            data: jadwalData,
          });
        }

        return tx.kelas.findUnique({
          where: { id: created.id },
          include: {
            jadwals: true,
            dosen: { select: { id: true, username: true, email: true } },
          },
        });
      });

      return res.status(201).json({
        success: true,
        message: "Kelas berhasil dibuat!",
        data: newClass,
      });
    } catch (err) {
      console.error("[KELAS] POST / error:", err);
      return res.status(500).json({ success: false, message: "Gagal membuat kelas: " + err.message });
    }
  }
);

// ─── PUT /api/kelas/:id ───────────────────────────────────────────────────────
// Dosen mengubah informasi kelas
router.put(
  "/:id",
  [
    body("kode").optional().trim().notEmpty().withMessage("Kode kelas tidak boleh kosong"),
    body("nama").optional().trim().notEmpty().withMessage("Nama kelas tidak boleh kosong"),
    body("deskripsi").optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { kode, nama, deskripsi } = req.body;

    try {
      const { error } = await checkKelasAccess(id, req.user);
      if (error) return res.status(error.status).json({ success: false, message: error.message });

      // Cek kode unik jika diubah
      if (kode) {
        const existingKode = await prisma.kelas.findFirst({
          where: { kode, NOT: { id } },
        });
        if (existingKode) {
          return res.status(400).json({
            success: false,
            message: `Kode kelas '${kode}' sudah dipakai kelas lain.`,
          });
        }
      }

      const updated = await prisma.kelas.update({
        where: { id },
        data: {
          ...(kode ? { kode } : {}),
          ...(nama ? { nama } : {}),
          ...(deskripsi !== undefined ? { deskripsi } : {}),
        },
        include: {
          jadwals: true,
          dosen: { select: { id: true, username: true, email: true } },
        },
      });

      return res.json({
        success: true,
        message: "Informasi kelas berhasil diperbarui.",
        data: updated,
      });
    } catch (err) {
      console.error("[KELAS] PUT /:id error:", err);
      return res.status(500).json({ success: false, message: "Gagal memperbarui kelas: " + err.message });
    }
  }
);

// ─── DELETE /api/kelas/:id ────────────────────────────────────────────────────
// Dosen menghapus kelas miliknya
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await checkKelasAccess(id, req.user);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    await prisma.kelas.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: "Kelas beserta jadwal dan daftar anggotanya berhasil dihapus.",
    });
  } catch (err) {
    console.error("[KELAS] DELETE /:id error:", err);
    return res.status(500).json({ success: false, message: "Gagal menghapus kelas: " + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MANAJEMEN JADWAL KELAS
// ═══════════════════════════════════════════════════════════════════════════════

const validHari = ["SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU", "MINGGU"];

// ─── POST /api/kelas/:id/jadwal ───────────────────────────────────────────────
// Menambahkan jadwal ke kelas
router.post(
  "/:id/jadwal",
  [
    body("hari").isIn(validHari).withMessage(`Hari harus salah satu dari: ${validHari.join(", ")}`),
    body("jamMulai").matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage("Format jamMulai harus HH:mm (contoh 08:00)"),
    body("jamSelesai").matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage("Format jamSelesai harus HH:mm (contoh 10:30)"),
    body("ruangan").optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { hari, jamMulai, jamSelesai, ruangan } = req.body;

    try {
      const { error } = await checkKelasAccess(id, req.user);
      if (error) return res.status(error.status).json({ success: false, message: error.message });

      const newJadwal = await prisma.jadwalKelas.create({
        data: {
          kelasId: id,
          hari,
          jamMulai,
          jamSelesai,
          ruangan: ruangan || null,
        },
      });

      return res.status(201).json({
        success: true,
        message: "Jadwal kelas berhasil ditambahkan.",
        data: newJadwal,
      });
    } catch (err) {
      console.error("[KELAS] POST /:id/jadwal error:", err);
      return res.status(500).json({ success: false, message: "Gagal menambahkan jadwal: " + err.message });
    }
  }
);

// ─── DELETE /api/kelas/:id/jadwal/:jadwalId ───────────────────────────────────
// Menghapus jadwal dari kelas
router.delete("/:id/jadwal/:jadwalId", async (req, res) => {
  const { id, jadwalId } = req.params;

  try {
    const { error } = await checkKelasAccess(id, req.user);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const jadwal = await prisma.jadwalKelas.findFirst({
      where: { id: jadwalId, kelasId: id },
    });

    if (!jadwal) {
      return res.status(404).json({ success: false, message: "Jadwal kelas tidak ditemukan." });
    }

    await prisma.jadwalKelas.delete({
      where: { id: jadwalId },
    });

    return res.json({
      success: true,
      message: "Jadwal perkuliahan berhasil dihapus.",
    });
  } catch (err) {
    console.error("[KELAS] DELETE /:id/jadwal/:jadwalId error:", err);
    return res.status(500).json({ success: false, message: "Gagal menghapus jadwal: " + err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MANAJEMEN MAHASISWA DI KELAS (ENROLLMENT: TAMBAH & HAPUS MAHASISWA)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/kelas/:id/mahasiswa ─────────────────────────────────────────────
// Mengambil daftar mahasiswa di kelas ini
router.get("/:id/mahasiswa", async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await checkKelasAccess(id, req.user);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const members = await prisma.kelasMahasiswa.findMany({
      where: { kelasId: id },
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

    return res.json({
      success: true,
      total: members.length,
      data: members.map((m) => ({
        ...m.mahasiswa,
        enrolledAt: m.enrolledAt,
      })),
    });
  } catch (err) {
    console.error("[KELAS] GET /:id/mahasiswa error:", err);
    return res.status(500).json({ success: false, message: "Gagal memuat mahasiswa kelas: " + err.message });
  }
});

// ─── POST /api/kelas/:id/mahasiswa ────────────────────────────────────────────
// Menambahkan 1 mahasiswa ke kelas (bisa via mahasiswaId atau nim)
router.post(
  "/:id/mahasiswa",
  [
    body().custom((val) => {
      if (!val.mahasiswaId && !val.nim) {
        throw new Error("Wajib menyertakan 'nim' atau 'mahasiswaId'");
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { mahasiswaId, nim } = req.body;

    try {
      const { error, kelas } = await checkKelasAccess(id, req.user);
      if (error) return res.status(error.status).json({ success: false, message: error.message });

      // Cari data mahasiswa di master
      const targetMhs = await prisma.mahasiswa.findFirst({
        where: mahasiswaId ? { id: mahasiswaId } : { nim: String(nim).trim() },
      });

      if (!targetMhs) {
        return res.status(404).json({
          success: false,
          message: `Mahasiswa dengan ${mahasiswaId ? 'ID ' + mahasiswaId : 'NIM ' + nim} tidak ditemukan di database.`,
        });
      }

      // Cek apakah sudah terdaftar di kelas
      const alreadyEnrolled = await prisma.kelasMahasiswa.findUnique({
        where: {
          kelasId_mahasiswaId: {
            kelasId: id,
            mahasiswaId: targetMhs.id,
          },
        },
      });

      if (alreadyEnrolled) {
        return res.status(400).json({
          success: false,
          message: `Mahasiswa ${targetMhs.name} (${targetMhs.nim}) sudah terdaftar di kelas ${kelas.nama}.`,
        });
      }

      const enrolled = await prisma.kelasMahasiswa.create({
        data: {
          kelasId: id,
          mahasiswaId: targetMhs.id,
        },
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
      });

      return res.status(201).json({
        success: true,
        message: `Mahasiswa ${targetMhs.name} (${targetMhs.nim}) berhasil ditambahkan ke kelas!`,
        data: {
          ...enrolled.mahasiswa,
          enrolledAt: enrolled.enrolledAt,
        },
      });
    } catch (err) {
      console.error("[KELAS] POST /:id/mahasiswa error:", err);
      return res.status(500).json({ success: false, message: "Gagal menambahkan mahasiswa: " + err.message });
    }
  }
);

// ─── POST /api/kelas/:id/mahasiswa/bulk ───────────────────────────────────────
// Menambahkan beberapa mahasiswa sekaligus berdasarkan array NIM
router.post(
  "/:id/mahasiswa/bulk",
  [
    body("nims").isArray({ min: 1 }).withMessage("Parameter 'nims' harus berupa array NIM mahasiswa minimal 1"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { nims } = req.body;

    try {
      const { error, kelas } = await checkKelasAccess(id, req.user);
      if (error) return res.status(error.status).json({ success: false, message: error.message });

      const cleanNims = [...new Set(nims.map((n) => String(n).trim()))];

      // Cari semua mahasiswa dengan NIM tersebut
      const foundMahasiswas = await prisma.mahasiswa.findMany({
        where: { nim: { in: cleanNims } },
        select: { id: true, nim: true, name: true },
      });

      const foundNimSet = new Set(foundMahasiswas.map((m) => m.nim));
      const notFoundNims = cleanNims.filter((n) => !foundNimSet.has(n));

      // Cek yang sudah terdaftar
      const existingEnrolled = await prisma.kelasMahasiswa.findMany({
        where: {
          kelasId: id,
          mahasiswaId: { in: foundMahasiswas.map((m) => m.id) },
        },
        select: { mahasiswaId: true },
      });
      const enrolledSet = new Set(existingEnrolled.map((e) => e.mahasiswaId));

      const toAdd = foundMahasiswas.filter((m) => !enrolledSet.has(m.id));
      const alreadyEnrolledMhs = foundMahasiswas.filter((m) => enrolledSet.has(m.id));

      if (toAdd.length > 0) {
        await prisma.kelasMahasiswa.createMany({
          data: toAdd.map((m) => ({
            kelasId: id,
            mahasiswaId: m.id,
          })),
        });
      }

      return res.status(201).json({
        success: true,
        message: `Berhasil menambahkan ${toAdd.length} mahasiswa ke kelas ${kelas.nama}.`,
        summary: {
          totalAdded: toAdd.length,
          added: toAdd.map((m) => ({ nim: m.nim, name: m.name })),
          alreadyEnrolled: alreadyEnrolledMhs.map((m) => ({ nim: m.nim, name: m.name })),
          notFound: notFoundNims,
        },
      });
    } catch (err) {
      console.error("[KELAS] POST /:id/mahasiswa/bulk error:", err);
      return res.status(500).json({ success: false, message: "Gagal menambahkan mahasiswa massal: " + err.message });
    }
  }
);

// ─── POST /api/kelas/:id/mahasiswa/import-csv ─────────────────────────────────
// Import mahasiswa dari CSV, upsert ke database master, lalu daftarkan ke kelas
// Body: { students: [{ nim, name, email?, jurusan, semester }] }
router.post("/:id/mahasiswa/import-csv", async (req, res) => {
  const { id } = req.params;
  const { students } = req.body;

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Data students harus berupa array dan tidak boleh kosong.",
    });
  }

  try {
    const { error, kelas } = await checkKelasAccess(id, req.user);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const summary = { imported: 0, updated: 0, enrolled: 0, alreadyEnrolled: 0, errors: [] };

    for (const s of students) {
      const nim = String(s.nim || "").trim();
      const name = String(s.name || s.nama || "").trim();
      const jurusan = String(s.jurusan || "").trim();
      const semester = parseInt(s.semester) || 1;
      const email = s.email ? String(s.email).trim().toLowerCase() : null;

      if (!nim || !name || !jurusan) {
        summary.errors.push({ nim, reason: "NIM, Nama, dan Jurusan wajib diisi." });
        continue;
      }

      let mahasiswaId;

      try {
        // Upsert ke tabel master mahasiswas
        const existing = await prisma.mahasiswa.findUnique({ where: { nim } });

        if (existing) {
          await prisma.mahasiswa.update({
            where: { nim },
            data: {
              name,
              jurusan,
              semester,
              ...(email && email !== existing.email ? { email } : {}),
            },
          });
          mahasiswaId = existing.id;
          summary.updated++;
        } else {
          const created = await prisma.mahasiswa.create({
            data: { nim, name, email, jurusan, semester, password: "" },
          });
          mahasiswaId = created.id;
          summary.imported++;
        }

        // Daftarkan ke kelas jika belum terdaftar
        const alreadyIn = await prisma.kelasMahasiswa.findUnique({
          where: { kelasId_mahasiswaId: { kelasId: id, mahasiswaId } },
        });

        if (alreadyIn) {
          summary.alreadyEnrolled++;
        } else {
          await prisma.kelasMahasiswa.create({
            data: { kelasId: id, mahasiswaId },
          });
          summary.enrolled++;
        }
      } catch (rowErr) {
        summary.errors.push({ nim, reason: rowErr.message });
      }
    }

    return res.status(201).json({
      success: true,
      message: `Import ke kelas ${kelas.nama} selesai. ${summary.enrolled} baru terdaftar, ${summary.alreadyEnrolled} sudah ada.`,
      data: summary,
    });
  } catch (err) {
    console.error("[KELAS] POST /:id/mahasiswa/import-csv error:", err);
    return res.status(500).json({ success: false, message: "Gagal import CSV: " + err.message });
  }
});

// ─── DELETE /api/kelas/:id/mahasiswa/:mahasiswaId ─────────────────────────────
// Dosen mengeluarkan / menghapus mahasiswa dari kelas ini
router.delete("/:id/mahasiswa/:mahasiswaId", async (req, res) => {
  const { id, mahasiswaId } = req.params;

  try {
    const { error, kelas } = await checkKelasAccess(id, req.user);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    let enrollment = await prisma.kelasMahasiswa.findUnique({
      where: {
        kelasId_mahasiswaId: {
          kelasId: id,
          mahasiswaId,
        },
      },
      include: {
        mahasiswa: { select: { nim: true, name: true } },
      },
    });

    if (!enrollment) {
      const mhsByNim = await prisma.mahasiswa.findUnique({ where: { nim: mahasiswaId } });
      if (mhsByNim) {
        enrollment = await prisma.kelasMahasiswa.findUnique({
          where: {
            kelasId_mahasiswaId: {
              kelasId: id,
              mahasiswaId: mhsByNim.id,
            },
          },
          include: {
            mahasiswa: { select: { nim: true, name: true } },
          },
        });
      }
    }

    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Mahasiswa tidak terdaftar di kelas ini.",
      });
    }

    await prisma.kelasMahasiswa.delete({
      where: {
        kelasId_mahasiswaId: {
          kelasId: id,
          mahasiswaId,
        },
      },
    });

    return res.json({
      success: true,
      message: `Mahasiswa ${enrollment.mahasiswa.name} (${enrollment.mahasiswa.nim}) berhasil dikeluarkan dari kelas ${kelas.nama}.`,
    });
  } catch (err) {
    console.error("[KELAS] DELETE /:id/mahasiswa/:mahasiswaId error:", err);
    return res.status(500).json({ success: false, message: "Gagal mengeluarkan mahasiswa: " + err.message });
  }
});


// ─── GET /api/kelas/:id/attendance ──────────────────────────────────────────
// Mengambil data absensi mahasiswa kelas untuk tanggal atau pertemuan tertentu
router.get("/:id/attendance", async (req, res) => {
  const { id } = req.params;
  const { date, pertemuanKe } = req.query;

  try {
    const { error, kelas } = await checkKelasAccess(id, req.user);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const todayWIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const targetDateStr = date && date !== "undefined" ? date : todayWIB;
    const targetDate = new Date(`${targetDateStr}T00:00:00.000Z`);
    const targetPertemuan = pertemuanKe ? parseInt(pertemuanKe, 10) : null;

    const enrolledMembers = await prisma.kelasMahasiswa.findMany({
      where: { kelasId: id },
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

    const attendanceFilter = {
      kelasId: id,
      ...(targetPertemuan !== null ? { pertemuanKe: targetPertemuan } : { date: targetDate }),
    };

    const attendances = await prisma.attendance.findMany({
      where: attendanceFilter,
    });

    const attendanceMap = new Map();
    attendances.forEach((att) => {
      attendanceMap.set(att.mahasiswaId, att);
    });

    const roster = enrolledMembers.map((em) => {
      const att = attendanceMap.get(em.mahasiswa.id);
      return {
        id: em.mahasiswa.id,
        mahasiswaId: em.mahasiswa.id,
        nim: em.mahasiswa.nim,
        name: em.mahasiswa.name,
        jurusan: em.mahasiswa.jurusan,
        semester: em.mahasiswa.semester,
        attendanceId: att ? att.id : null,
        status: att ? att.status : "NOT_RECORDED",
        checkIn: att ? att.checkIn : null,
        checkOut: att ? att.checkOut : null,
        notes: att ? att.notes : "",
        photo: att ? att.photo : null,
        latitude: att ? att.latitude : null,
        longitude: att ? att.longitude : null,
        distance: att ? att.distance : null,
        isLocationValid: att ? att.isLocationValid : false,
        pertemuanKe: att?.pertemuanKe ?? targetPertemuan ?? 1,
      };
    });

    const stats = {
      total: roster.length,
      present: roster.filter((r) => r.status === "PRESENT").length,
      late: roster.filter((r) => r.status === "LATE").length,
      absent: roster.filter((r) => r.status === "ABSENT").length,
      izin: roster.filter((r) => r.status === "IZIN").length,
      sakit: roster.filter((r) => r.status === "SAKIT").length,
      notRecorded: roster.filter((r) => r.status === "NOT_RECORDED").length,
    };

    const responsePayload = {
      date: targetDateStr,
      kelas: {
        id: kelas.id,
        kode: kelas.kode,
        nama: kelas.nama,
        dosen: kelas.dosen,
        jadwals: kelas.jadwals,
      },
      jadwal: kelas.jadwals?.[0] || null,
      pertemuanKe: targetPertemuan ?? 1,
      stats,
      students: roster,
      data: roster,
    };

    return res.json({
      success: true,
      data: responsePayload,
      students: roster,
      stats,
    });
  } catch (err) {
    console.error("[KELAS] GET /:id/attendance error:", err);
    return res.status(500).json({ success: false, message: "Gagal memuat absensi kelas: " + err.message });
  }
});

// ─── POST /api/kelas/:id/attendance ─────────────────────────────────────────
// Mencatat atau memperbarui absensi kelas (batch atau satuan)
router.post("/:id/attendance", async (req, res) => {
  const { id } = req.params;
  const { date, pertemuanKe, records, mahasiswaId, status, notes } = req.body;

  try {
    const { error, kelas } = await checkKelasAccess(id, req.user);
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    const todayWIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const targetDateStr = date && date !== "undefined" ? date : todayWIB;
    const targetDate = new Date(`${targetDateStr}T00:00:00.000Z`);
    const targetPertemuan = pertemuanKe ? parseInt(pertemuanKe, 10) : 1;

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
      const identifier = item.mahasiswaId || item.nim;
      if (!identifier) continue;

      // Cari mahasiswa berdasarkan ID atau NIM
      const targetMhs = await prisma.mahasiswa.findFirst({
        where: {
          OR: [{ id: identifier }, { nim: String(identifier).trim() }],
        },
        select: { id: true, nim: true, name: true },
      });

      if (!targetMhs) continue;

      const rawStatus = (item.status || "PRESENT").toUpperCase();
      const attStatus = validStatuses.includes(rawStatus) ? rawStatus : "PRESENT";

      const existing = await prisma.attendance.findFirst({
        where: {
          mahasiswaId: targetMhs.id,
          kelasId: id,
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
        });
        results.push(updated);
      } else {
        const created = await prisma.attendance.create({
          data: {
            mahasiswaId: targetMhs.id,
            kelasId: id,
            pertemuanKe: targetPertemuan,
            date: targetDate,
            status: attStatus,
            checkIn: attStatus === "PRESENT" || attStatus === "LATE" ? now : null,
            notes: item.notes || null,
          },
        });
        results.push(created);
      }
    }

    return res.json({
      success: true,
      message: `Berhasil mencatat absensi ${results.length} mahasiswa untuk kelas ${kelas.nama}.`,
      totalProcessed: results.length,
      data: results,
    });
  } catch (err) {
    console.error("[KELAS] POST /:id/attendance error:", err);
    return res.status(500).json({ success: false, message: "Gagal mencatat absensi: " + err.message });
  }
});

module.exports = router;

