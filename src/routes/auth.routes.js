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
