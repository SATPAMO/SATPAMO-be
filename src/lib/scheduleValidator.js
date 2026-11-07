/**
 * scheduleValidator.js
 * Utilitas untuk parsing CSV/Excel dan validasi bentrok jadwal perkuliahan (Dosen & Ruangan)
 */

const XLSX = require("xlsx");

const VALID_HARI = ["SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU", "MINGGU"];
const TIME_REGEX = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Normalisasi format jam ke HH:mm (contoh: "8:00" -> "08:00")
 */
function normalizeTime(timeStr) {
  if (!timeStr) return null;
  const trimmed = String(timeStr).trim();
  const parts = trimmed.split(":");
  if (parts.length !== 2) return null;
  const hour = parts[0].padStart(2, "0");
  const minute = parts[1].padStart(2, "0");
  const formatted = `${hour}:${minute}`;
  return TIME_REGEX.test(formatted) ? formatted : null;
}

/**
 * Cek apakah dua rentang waktu saling bertabrakan / overlap
 * Rumus: startA < endB && endA > startB
 */
function isTimeOverlapping(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

/**
 * Parse teks CSV mentah menjadi array of objects.
 * Mendukung pemisah koma (,) maupun titik-koma (;), serta quoted string ("...").
 */
function parseCsvString(csvText) {
  if (!csvText || typeof csvText !== "string") return [];

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  // Deteksi delimiter dari baris header (koma atau titik koma)
  const headerLine = lines[0];
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  const delimiter = semicolonCount > commaCount ? ";" : ",";

  // Helper untuk memecah baris CSV dengan memperhitungkan tanda petik ganda
  const splitLine = (text) => {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim().replace(/^"(.*)"$/, "$1").replace(/""/g, '"'));
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"(.*)"$/, "$1").replace(/""/g, '"'));
    return result;
  };

  const rawHeaders = splitLine(headerLine);
  const normalizedHeaders = rawHeaders.map((h) =>
    h
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
  );

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    if (values.length === 0 || values.every((v) => !v)) continue;

    const rowObj = {};
    normalizedHeaders.forEach((key, idx) => {
      rowObj[key] = values[idx] !== undefined ? values[idx].trim() : "";
    });
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Parse buffer file Excel (.xlsx / .xls) menjadi array of objects.
 * Mengambil sheet pertama dan menormalkan nama kolom ke lowercase + underscore.
 */
function parseExcelBuffer(buffer) {
  if (!buffer) return [];

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  return rawRows.map((row) => {
    const normalized = {};
    for (const key of Object.keys(row)) {
      const cleanKey = key
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      normalized[cleanKey] = typeof row[key] === "string" ? row[key].trim() : String(row[key]);
    }
    return normalized;
  });
}

/**
 * Validasi bentrok jadwal dosen dan ruangan terhadap database
 *
 * @param {object} prisma - Prisma Client instance
 * @param {object} params
 * @param {string} params.dosenId - ID Dosen pengampu
 * @param {string} params.hari - Hari (SENIN - MINGGU)
 * @param {string} params.jamMulai - Format "HH:mm"
 * @param {string} params.jamSelesai - Format "HH:mm"
 * @param {string} [params.ruangan] - Nama ruangan (opsional)
 * @param {string} [params.excludeKelasId] - ID kelas yang dikecualikan (jika update)
 * @returns {Promise<{ hasConflict: boolean, reason?: string, type?: string }>}
 */
async function checkScheduleConflict(prisma, { dosenId, hari, jamMulai, jamSelesai, ruangan, excludeKelasId }) {
  // 1. Validasi format dasar
  const normalizedHari = String(hari || "").toUpperCase().trim();
  if (!VALID_HARI.includes(normalizedHari)) {
    return {
      hasConflict: true,
      type: "INVALID_FORMAT",
      reason: `Hari '${hari}' tidak valid. Harus salah satu dari: ${VALID_HARI.join(", ")}.`,
    };
  }

  const start = normalizeTime(jamMulai);
  const end = normalizeTime(jamSelesai);

  if (!start || !end) {
    return {
      hasConflict: true,
      type: "INVALID_FORMAT",
      reason: `Format jam tidak valid (Mulai: '${jamMulai}', Selesai: '${jamSelesai}'). Gunakan format HH:mm.`,
    };
  }

  if (start >= end) {
    return {
      hasConflict: true,
      type: "INVALID_FORMAT",
      reason: `Jam selesai (${end}) harus lebih besar dari jam mulai (${start}).`,
    };
  }

  // 2. Cek Bentrok Jadwal Dosen
  const dosenSchedules = await prisma.jadwalKelas.findMany({
    where: {
      hari: normalizedHari,
      kelas: {
        dosenId,
        ...(excludeKelasId ? { id: { not: excludeKelasId } } : {}),
      },
    },
    include: {
      kelas: { select: { id: true, kode: true, nama: true } },
    },
  });

  for (const s of dosenSchedules) {
    if (isTimeOverlapping(start, end, s.jamMulai, s.jamSelesai)) {
      return {
        hasConflict: true,
        type: "DOSEN_CONFLICT",
        reason: `Bentrok Dosen: Anda sudah memiliki jadwal mengajar di kelas '${s.kelas.nama}' (${s.kelas.kode}) pada hari ${normalizedHari} pukul ${s.jamMulai} - ${s.jamSelesai}.`,
      };
    }
  }

  // 3. Cek Bentrok Penggunaan Ruangan (jika ruangan diisi)
  if (ruangan && String(ruangan).trim()) {
    const cleanRuangan = String(ruangan).trim();
    const roomSchedules = await prisma.jadwalKelas.findMany({
      where: {
        hari: normalizedHari,
        ruangan: cleanRuangan,
        ...(excludeKelasId ? { kelasId: { not: excludeKelasId } } : {}),
      },
      include: {
        kelas: {
          select: {
            id: true,
            kode: true,
            nama: true,
            dosen: { select: { username: true } },
          },
        },
      },
    });

    for (const s of roomSchedules) {
      if (isTimeOverlapping(start, end, s.jamMulai, s.jamSelesai)) {
        const dosenPengampu = s.kelas.dosen?.username || "Dosen lain";
        return {
          hasConflict: true,
          type: "ROOM_CONFLICT",
          reason: `Bentrok Ruangan: Ruangan '${cleanRuangan}' sudah digunakan oleh kelas '${s.kelas.nama}' (${s.kelas.kode}) yang diampu ${dosenPengampu} pada hari ${normalizedHari} pukul ${s.jamMulai} - ${s.jamSelesai}.`,
        };
      }
    }
  }

  return {
    hasConflict: false,
    normalizedHari,
    normalizedJamMulai: start,
    normalizedJamSelesai: end,
    normalizedRuangan: ruangan ? String(ruangan).trim() : null,
  };
}

module.exports = {
  VALID_HARI,
  normalizeTime,
  isTimeOverlapping,
  parseCsvString,
  parseExcelBuffer,
  checkScheduleConflict,
};

