const express = require("express");
const { body, query, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ─── GET /api/mahasiswa/public ────────────────────────────────────────────────
// Daftar mahasiswa publik untuk dropdown presensi (nim, name, jurusan)
router.get("/public", async (_req, res) => {
  try {
    const mahasiswas = await prisma.mahasiswa.findMany({
      select: { id: true, nim: true, name: true, jurusan: true, semester: true },
      orderBy: { name: "asc" },
    });
    return res.json({ success: true, data: mahasiswas });
  } catch (err) {
    console.error("[MAHASISWA] GET /public error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// Semua route di bawah ini membutuhkan autentikasi
router.use(authenticate);

// ─── GET /api/mahasiswa ───────────────────────────────────────────────────────
// Query params: ?jurusan=TI&semester=3&search=budi
router.get("/", async (req, res) => {
  const { jurusan, semester, search } = req.query;

  try {
    const mahasiswas = await prisma.mahasiswa.findMany({
      where: {
        AND: [
          jurusan ? { jurusan: { contains: jurusan } } : {},
          semester ? { semester: parseInt(semester) } : {},
          search
            ? {
                OR: [
                  { name: { contains: search } },
                  { nim: { contains: search } },
                ],
              }
            : {},
        ],
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        nim: true,
        name: true,
        email: true,
        jurusan: true,
        semester: true,
        createdAt: true,
        _count: { select: { attendances: true } },
      },
    });

    return res.json({ success: true, data: mahasiswas, total: mahasiswas.length });
  } catch (err) {
    console.error("[MAHASISWA] GET / error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── GET /api/mahasiswa/:id ───────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const mahasiswa = await prisma.mahasiswa.findUnique({
      where: { id: req.params.id },
      include: {
        attendances: {
          orderBy: { date: "desc" },
          take: 30,
        },
      },
    });

    if (!mahasiswa) {
      return res.status(404).json({ success: false, message: "Mahasiswa tidak ditemukan." });
    }

    return res.json({ success: true, data: mahasiswa });
  } catch (err) {
    console.error("[MAHASISWA] GET /:id error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── POST /api/mahasiswa ──────────────────────────────────────────────────────
const createValidation = [
  body("nim").trim().notEmpty().withMessage("NIM wajib diisi"),
  body("name").trim().isLength({ min: 2 }).withMessage("Nama minimal 2 karakter"),
  body("jurusan").trim().notEmpty().withMessage("Jurusan wajib diisi"),
  body("semester")
    .isInt({ min: 1, max: 14 })
    .withMessage("Semester harus antara 1-14"),
  body("email").optional().isEmail().normalizeEmail(),
];

router.post("/", createValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { nim, name, email, jurusan, semester } = req.body;

  try {
    const existing = await prisma.mahasiswa.findUnique({ where: { nim } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `NIM ${nim} sudah terdaftar.`,
      });
    }

    const mahasiswa = await prisma.mahasiswa.create({
      data: { nim, name, email: email || null, jurusan, semester: parseInt(semester) },
    });

    return res.status(201).json({
      success: true,
      message: "Mahasiswa berhasil ditambahkan.",
      data: mahasiswa,
    });
  } catch (err) {
    console.error("[MAHASISWA] POST / error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── PUT /api/mahasiswa/:id ───────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const { name, email, jurusan, semester } = req.body;

  try {
    const mahasiswa = await prisma.mahasiswa.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(email !== undefined && { email }),
        ...(jurusan && { jurusan }),
        ...(semester && { semester: parseInt(semester) }),
      },
    });

    return res.json({ success: true, message: "Data mahasiswa diperbarui.", data: mahasiswa });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, message: "Mahasiswa tidak ditemukan." });
    }
    console.error("[MAHASISWA] PUT /:id error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── DELETE /api/mahasiswa/:id ────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await prisma.mahasiswa.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: "Mahasiswa berhasil dihapus." });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, message: "Mahasiswa tidak ditemukan." });
    }
    console.error("[MAHASISWA] DELETE /:id error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

module.exports = router;
