/**
 * email.service.js
 * Layanan pengiriman email transaksi (Aktivasi Akun Mahasiswa, dll.)
 */

const nodemailer = require("nodemailer");

/**
 * Buat instance SMTP Transporter berdasarkan konfigurasi environment
 */
function createTransporter() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const secure = port === 465;
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  if (!user || !pass) {
    return null; // Mode dev jika belum diset kredensial email
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

/**
 * Kirim email link aktivasi akun ke Gmail mahasiswa
 *
 * @param {object} params
 * @param {string} params.to - Alamat email mahasiswa tujuan
 * @param {string} params.name - Nama lengkap mahasiswa
 * @param {string} params.nim - NIM mahasiswa
 * @param {string} params.activationUrl - URL lengkap tautan aktivasi
 */
async function sendActivationEmail({ to, name, nim, activationUrl }) {
  const transporter = createTransporter();

  const appName = "SAMA - Sistem Absensi Mahasiswa Akademik";
  const senderEmail = process.env.SMTP_USER || process.env.EMAIL_USER || "noreply@sama.kampus.ac.id";

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aktivasi Akun Mahasiswa</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 20px; color: #1e293b; }
      .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
      .header { background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 32px 24px; text-align: center; color: #ffffff; }
      .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
      .header p { margin: 6px 0 0 0; font-size: 14px; opacity: 0.9; }
      .content { padding: 32px 24px; line-height: 1.6; }
      .greeting { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
      .info-box { background-color: #f1f5f9; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 6px; margin: 20px 0; font-size: 14px; }
      .btn-container { text-align: center; margin: 30px 0; }
      .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 2px 6px rgba(37,99,235,0.3); }
      .footer { background-color: #f8fafc; padding: 20px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
      .link-alt { word-break: break-all; font-size: 12px; color: #2563eb; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>SAMA Kampus</h1>
        <p>Sistem Absensi Mahasiswa & Akademik</p>
      </div>
      <div class="content">
        <div class="greeting">Halo, ${name}! 👋</div>
        <p>Data Anda telah didaftarkan ke sistem perkuliahan oleh Dosen pengampu kelas. Untuk dapat login dan mengakses jadwal serta presensi kuliah, silakan lakukan aktivasi akun Anda terlebih dahulu.</p>
        
        <div class="info-box">
          <strong>Detail Mahasiswa:</strong><br>
          • <strong>Nama:</strong> ${name}<br>
          • <strong>NIM:</strong> ${nim}<br>
          • <strong>Email Terdaftar:</strong> ${to}
        </div>

        <p>Silakan klik tombol di bawah ini untuk membuat password akun Anda:</p>
        
        <div class="btn-container">
          <a href="${activationUrl}" class="btn" target="_blank">Aktivasi Akun Sekarang</a>
        </div>

        <p style="font-size: 13px; color: #64748b;">
          *Tautan aktivasi ini hanya berlaku selama <strong>24 jam</strong>. Jika Anda tidak merasa mendaftar atau berkuliah di kelas ini, silakan abaikan email ini.
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
        <p style="font-size: 12px; color: #64748b;">Jika tombol di atas tidak berfungsi, salin dan buka tautan berikut di browser Anda:<br>
          <a href="${activationUrl}" class="link-alt">${activationUrl}</a>
        </p>
      </div>
      <div class="footer">
        © ${new Date().getFullYear()} ${appName}. Seluruh hak cipta dilindungi.
      </div>
    </div>
  </body>
  </html>
  `;

  // Jika kredensial SMTP belum diset (misal di lokal developer belum isi SMTP_PASS di .env)
  if (!transporter) {
    console.log("\n=======================================================");
    console.log(`[EMAIL-DEV] Mode Simulasi (Kredensial SMTP belum diset di .env)`);
    console.log(`[EMAIL-DEV] Kepada: ${to} (${name} - NIM ${nim})`);
    console.log(`[EMAIL-DEV] Link Aktivasi: ${activationUrl}`);
    console.log("=======================================================\n");
    return {
      success: true,
      devMode: true,
      activationUrl,
      message: "Email simulasi dicetak di console server (SMTP belum diset).",
    };
  }

  const mailOptions = {
    from: `"${appName}" <${senderEmail}>`,
    to,
    subject: `Aktivasi Akun Mahasiswa - ${name} (${nim})`,
    html: htmlContent,
    text: `Halo ${name} (${nim}), silakan aktivasi akun SAMA Anda melalui tautan berikut: ${activationUrl} (berlaku 24 jam).`,
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    messageId: info.messageId,
  };
}

module.exports = {
  createTransporter,
  sendActivationEmail,
};

