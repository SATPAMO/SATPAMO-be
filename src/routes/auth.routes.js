const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ─── Validation rules ────────────────────────────────────────────────────────

const registerValidation = [
  body("username")
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage("Username harus 3-30 karakter")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username hanya boleh huruf, angka, dan underscore"),
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Format email tidak valid"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password minimal 6 karakter"),
];

const loginValidation = [
  body("identifier")
    .optional()
    .trim()
    .isLength({ min: 3, max: 60 })
    .withMessage("Email/NIM harus 3-60 karakter"),
  body("email").optional().isEmail().normalizeEmail().withMessage("Format email tidak valid"),
  body("password").notEmpty().withMessage("Password tidak boleh kosong"),
];

// ─── Helper: generate JWT ────────────────────────────────────────────────────

function signToken(dosen) {
  return jwt.sign(
    { id: dosen.id, username: dosen.username, email: dosen.email, role: dosen.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

function signMahasiswaToken(mahasiswa) {
  return jwt.sign(
    { id: mahasiswa.id, nim: mahasiswa.nim, email: mahasiswa.email, role: "MAHASISWA" },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────
router.post("/register", registerValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { username, email, password, role } = req.body;

  try {
    // Cek duplikat
    const existing = await prisma.dosen.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: existing.email === email
          ? "Email sudah terdaftar."
          : "Username sudah digunakan.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const dosen = await prisma.dosen.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role: role === "ADMIN" ? "ADMIN" : "DOSEN",
      },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });

    const token = signToken(dosen);

    return res.status(201).json({
      success: true,
      message: "Akun berhasil dibuat.",
      data: { dosen, token },
    });
  } catch (err) {
    console.error("[AUTH] Register error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── POST /api/auth/register-mahasiswa ───────────────────────────────────────
// Aktivasi akun mahasiswa: validasi NIM & Nama dengan database master
router.post("/register-mahasiswa", async (req, res) => {
  const { nim, name, email, password } = req.body;

  if (!nim || !name || !password) {
    return res.status(400).json({
      success: false,
      message: "NIM, Nama Lengkap, dan Password wajib diisi.",
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password minimal 6 karakter.",
    });
  }

  try {
    // 1. Cari mahasiswa berdasarkan NIM
    const mahasiswa = await prisma.mahasiswa.findUnique({
      where: { nim: nim.trim() },
    });

    if (!mahasiswa) {
      return res.status(404).json({
        success: false,
        message: `NIM ${nim} belum terdaftar di database akademik. Silakan hubungi dosen/admin.`,
      });
    }

    // 2. Cocokkan nama (case-insensitive & whitespace-trimmed)
    const nameFromDb = mahasiswa.name.trim().toLowerCase();
    const nameFromReq = name.trim().toLowerCase();
    if (nameFromDb !== nameFromReq) {
      return res.status(400).json({
        success: false,
        message: `Nama lengkap tidak sesuai dengan data resmi NIM ${nim}. Harap periksa kembali ejaan nama Anda.`,
      });
    }

    // 3. Cek apakah akun sudah aktif
    if (mahasiswa.password && mahasiswa.password !== "") {
      return res.status(400).json({
        success: false,
        message: "Akun dengan NIM ini sudah pernah diaktivasi. Silakan langsung login.",
      });
    }

    // 4. Validasi email jika ada (cek duplikat)
    if (email) {
      const emailExists = await prisma.mahasiswa.findFirst({
        where: { email: email.toLowerCase(), NOT: { nim: nim.trim() } },
      });
      if (emailExists) {
        return res.status(409).json({
          success: false,
          message: "Email sudah digunakan oleh mahasiswa lain.",
        });
      }
    }

    // 5. Hash password & aktivasi akun
    const hashedPassword = await bcrypt.hash(password, 12);

    const updatedMahasiswa = await prisma.mahasiswa.update({
      where: { nim: nim.trim() },
      data: {
        password: hashedPassword,
        ...(email && { email: email.toLowerCase() }),
      },
      select: {
        id: true,
        nim: true,
        name: true,
        email: true,
        jurusan: true,
        semester: true,
        createdAt: true,
      },
    });

    const token = signMahasiswaToken(updatedMahasiswa);

    return res.status(200).json({
      success: true,
      message: "Akun berhasil diaktivasi. Selamat datang!",
      data: { mahasiswa: updatedMahasiswa, token },
    });
  } catch (err) {
    console.error("[AUTH] Register-mahasiswa error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────
// Login Mahasiswa (mobile): kirim { identifier: email ATAU nim, password }
// Login Dosen/Admin (web): kirim { email, password }
router.post("/login", loginValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { identifier, email, password } = req.body;

  try {
    // Login Mahasiswa
    if (identifier) {
      const mahasiswa = await prisma.mahasiswa.findFirst({
        where: {
          OR: [
            { email: identifier.toLowerCase() },
            { nim: identifier.toLowerCase() },
          ],
        },
      });

      if (!mahasiswa || !mahasiswa.password) {
        return res.status(401).json({ success: false, message: "Email/NIM atau password salah." });
      }

      const passwordMatch = await bcrypt.compare(password, mahasiswa.password);
      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: "Email/NIM atau password salah." });
      }

      const token = signMahasiswaToken(mahasiswa);
      const { password: _, ...mahasiswaSafe } = mahasiswa;

      return res.json({
        success: true,
        message: "Login berhasil.",
        data: { mahasiswa: mahasiswaSafe, token },
      });
    }

    // Login Dosen/Admin
    const dosen = await prisma.dosen.findUnique({ where: { email } });

    if (!dosen) {
      return res.status(401).json({ success: false, message: "Email atau password salah." });
    }

    const passwordMatch = await bcrypt.compare(password, dosen.password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: "Email atau password salah." });
    }

    const token = signToken(dosen);
    const { password: _, ...dosenSafe } = dosen;

    return res.json({
      success: true,
      message: "Login berhasil.",
      data: { dosen: dosenSafe, token },
    });
  } catch (err) {
    console.error("[AUTH] Login error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  try {
    const dosen = await prisma.dosen.findUnique({
      where: { id: req.dosen.id },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });

    if (!dosen) {
      return res.status(404).json({ success: false, message: "Akun tidak ditemukan." });
    }

    return res.json({ success: true, data: { dosen } });
  } catch (err) {
    console.error("[AUTH] Me error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

module.exports = router;
