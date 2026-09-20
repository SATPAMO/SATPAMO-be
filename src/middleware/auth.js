const jwt = require("jsonwebtoken");

/**
 * Middleware JWT Authentication
 * Memverifikasi token Bearer dari header Authorization
 * dan menyuntikkan data dosen ke req.dosen
 */
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Akses ditolak. Token tidak ditemukan.",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.dosen = decoded; // { id, username, email, role }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Sesi telah berakhir. Silakan login kembali.",
      });
    }
    return res.status(401).json({
      success: false,
      message: "Token tidak valid.",
    });
  }
}

/**
 * Middleware role-based authorization
 * Gunakan setelah authenticate()
 * Contoh: requireRole("ADMIN")
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.dosen) {
      return res.status(401).json({ success: false, message: "Tidak terautentikasi." });
    }
    if (!roles.includes(req.dosen.role)) {
      return res.status(403).json({
        success: false,
        message: `Akses ditolak. Dibutuhkan role: ${roles.join(" atau ")}.`,
      });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
