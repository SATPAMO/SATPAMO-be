const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");
const { authenticate } = require("../middleware/auth");
const { sendActivationEmail } = require("../services/email.service");

const router = express.Router();

/**
 * Masking email untuk privasi (contoh: budi@gmail.com -> b***i@gmail.com)
 */
function maskEmail(email) {
  if (!email || !email.includes("@")) return email;
  const [user, domain] = email.split("@");
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

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

// ─── POST /api/auth/request-activation ────────────────────────────────────────
// Mahasiswa meminta pengiriman link aktivasi akun ke Gmail terdaftar
router.post(
  "/request-activation",
  [
    body("nim").trim().notEmpty().withMessage("NIM wajib diisi"),
    body("email").optional().isEmail().normalizeEmail().withMessage("Format email tidak valid"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { nim, email } = req.body;

    try {
      const cleanNim = nim.trim();
      const mahasiswa = await prisma.mahasiswa.findUnique({
        where: { nim: cleanNim },
      });

      if (!mahasiswa) {
        return res.status(404).json({
          success: false,
          message: `NIM ${cleanNim} belum terdaftar di database akademik. Pastikan dosen telah mengimpor data kelas Anda.`,
        });
      }

      // Cek apakah akun sudah aktif (sudah punya password)
      if (mahasiswa.password && mahasiswa.password.trim() !== "") {
        return res.status(400).json({
          success: false,
          message: "Akun dengan NIM ini sudah aktif. Silakan langsung login.",
        });
      }

      let targetEmail = mahasiswa.email;

      // Jika email belum ada di database tetapi mahasiswa menyediakannya di request
      if (!targetEmail) {
        if (!email) {
          return res.status(400).json({
            success: false,
            message: "Mahasiswa belum memiliki email terdaftar di sistem. Harap sertakan email aktif Anda.",
          });
        }

        // Cek apakah email sudah digunakan mahasiswa lain
        const existingEmail = await prisma.mahasiswa.findFirst({
          where: { email: email.toLowerCase(), NOT: { nim: cleanNim } },
        });

        if (existingEmail) {
          return res.status(409).json({
            success: false,
            message: "Email ini sudah digunakan oleh mahasiswa lain.",
          });
        }

        await prisma.mahasiswa.update({
          where: { nim: cleanNim },
          data: { email: email.toLowerCase() },
        });

        targetEmail = email.toLowerCase();
      }

      // Generate token aktivasi berjangka 24 jam
      const activationToken = jwt.sign(
        {
          mahasiswaId: mahasiswa.id,
          nim: mahasiswa.nim,
          email: targetEmail,
          type: "ACCOUNT_ACTIVATION",
        },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      const clientAppUrl = (process.env.CLIENT_APP_URL || "http://localhost:5173").replace(/\/$/, "");
      const activationUrl = `${clientAppUrl}/aktivasi?token=${activationToken}`;

      // Kirim email aktivasi
      const emailResult = await sendActivationEmail({
        to: targetEmail,
        name: mahasiswa.name,
        nim: mahasiswa.nim,
        activationUrl,
      });

      return res.json({
        success: true,
        message: `Tautan aktivasi telah dikirim ke alamat email ${maskEmail(targetEmail)}. Silakan periksa kotak masuk atau spam.`,
        data: {
          nim: mahasiswa.nim,
          email: maskEmail(targetEmail),
          expiresIn: "24 jam",
          ...(emailResult.devMode ? { devMode: true, devActivationUrl: emailResult.activationUrl } : {}),
        },
      });
    } catch (err) {
      console.error("[AUTH] Request activation error:", err);
      return res.status(500).json({
        success: false,
        message: "Gagal mengirim email aktivasi: " + err.message,
      });
    }
  }
);

// ─── POST /api/auth/verify-activation-token ───────────────────────────────────
// Memvalidasi token aktivasi sebelum mahasiswa membuat password baru
router.post(
  "/verify-activation-token",
  [body("token").notEmpty().withMessage("Token aktivasi wajib disertakan")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { token } = req.body;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.type !== "ACCOUNT_ACTIVATION" || !decoded.mahasiswaId) {
        return res.status(400).json({
          success: false,
          message: "Tipe token tidak valid untuk aktivasi akun.",
        });
      }

      const mahasiswa = await prisma.mahasiswa.findUnique({
        where: { id: decoded.mahasiswaId },
        select: {
          id: true,
          nim: true,
          name: true,
          email: true,
          jurusan: true,
          semester: true,
          password: true,
        },
      });

      if (!mahasiswa) {
        return res.status(404).json({
          success: false,
          message: "Data mahasiswa tidak ditemukan.",
        });
      }

      if (mahasiswa.password && mahasiswa.password.trim() !== "") {
        return res.status(400).json({
          success: false,
          message: "Akun ini sudah pernah diaktivasi sebelumnya. Silakan langsung login.",
        });
      }

      const { password: _, ...mahasiswaSafe } = mahasiswa;

      return res.json({
        success: true,
        message: "Token aktivasi valid.",
        data: mahasiswaSafe,
      });
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(400).json({
          success: false,
          message: "Tautan aktivasi telah kedaluwarsa (lebih dari 24 jam). Silakan minta tautan baru.",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Tautan aktivasi tidak valid atau telah dimodifikasi.",
      });
    }
  }
);

// ─── POST /api/auth/activate ──────────────────────────────────────────────────
// Menyimpan password baru dan mengaktifkan akun mahasiswa
router.post(
  "/activate",
  [
    body("token").notEmpty().withMessage("Token aktivasi wajib disertakan"),
    body("password").isLength({ min: 6 }).withMessage("Password minimal 6 karakter"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { token, password } = req.body;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.type !== "ACCOUNT_ACTIVATION" || !decoded.mahasiswaId) {
        return res.status(400).json({
          success: false,
          message: "Tipe token tidak valid untuk aktivasi akun.",
        });
      }

      const mahasiswa = await prisma.mahasiswa.findUnique({
        where: { id: decoded.mahasiswaId },
      });

      if (!mahasiswa) {
        return res.status(404).json({
          success: false,
          message: "Data mahasiswa tidak ditemukan.",
        });
      }

      if (mahasiswa.password && mahasiswa.password.trim() !== "") {
        return res.status(400).json({
          success: false,
          message: "Akun ini sudah aktif. Silakan langsung login.",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const updatedMahasiswa = await prisma.mahasiswa.update({
        where: { id: mahasiswa.id },
        data: { password: hashedPassword },
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

      const loginToken = signMahasiswaToken(updatedMahasiswa);

      return res.status(200).json({
        success: true,
        message: "Aktivasi berhasil! Akun Anda kini aktif.",
        data: {
          mahasiswa: updatedMahasiswa,
          token: loginToken,
        },
      });
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(400).json({
          success: false,
          message: "Tautan aktivasi telah kedaluwarsa. Silakan minta tautan baru.",
        });
      }
      console.error("[AUTH] Activate error:", err);
      return res.status(400).json({
        success: false,
        message: "Tautan aktivasi tidak valid: " + err.message,
      });
    }
  }
);

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
    const loginKey = (identifier || email || "").trim();

    // 1. Cek Mahasiswa terlebih dahulu (bisa via NIM atau Email)
    if (loginKey) {
      const mahasiswa = await prisma.mahasiswa.findFirst({
        where: {
          OR: [
            { email: loginKey.toLowerCase() },
            { nim: loginKey },
          ],
        },
      });

      if (mahasiswa && mahasiswa.password) {
        const passwordMatch = await bcrypt.compare(password, mahasiswa.password);
        if (passwordMatch) {
          const token = signMahasiswaToken(mahasiswa);
          const { password: _, ...mahasiswaSafe } = mahasiswa;

          return res.json({
            success: true,
            message: "Login berhasil.",
            data: { mahasiswa: mahasiswaSafe, token },
          });
        } else {
          return res.status(401).json({ success: false, message: "NIM/Email atau password salah." });
        }
      }
    }

    // 2. Cek Dosen/Admin jika bukan mahasiswa (via Email atau Username)
    const dosen = await prisma.dosen.findFirst({
      where: {
        OR: [
          { email: loginKey.toLowerCase() },
          { username: loginKey },
        ],
      },
    });

    if (dosen && dosen.password) {
      const passwordMatch = await bcrypt.compare(password, dosen.password);
      if (passwordMatch) {
        const token = signToken(dosen);
        const { password: _, ...dosenSafe } = dosen;

        return res.json({
          success: true,
          message: "Login berhasil.",
          data: { dosen: dosenSafe, token },
        });
      }
    }

    return res.status(401).json({ success: false, message: "NIM/Email atau password salah." });
  } catch (err) {
    console.error("[AUTH] Login error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  try {
    if (req.user.role === "MAHASISWA") {
      const mahasiswa = await prisma.mahasiswa.findUnique({
        where: { id: req.user.id },
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

      if (!mahasiswa) {
        return res.status(404).json({ success: false, message: "Akun mahasiswa tidak ditemukan." });
      }

      return res.json({ success: true, data: { mahasiswa, role: "MAHASISWA" } });
    }

    const dosen = await prisma.dosen.findUnique({
      where: { id: req.dosen.id },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });

    if (!dosen) {
      return res.status(404).json({ success: false, message: "Akun tidak ditemukan." });
    }

    return res.json({ success: true, data: { dosen, role: dosen.role } });
  } catch (err) {
    console.error("[AUTH] Me error:", err);
    return res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
  }
});

module.exports = router;
