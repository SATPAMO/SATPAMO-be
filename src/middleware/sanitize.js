/**
 * sanitize.js
 * Dua fungsi keamanan untuk lapisan AI:
 *   1. anonymizeMahasiswa — hapus PII sebelum dikirim ke Gemini
 *   2. guardPromptInjection — blokir jailbreak/injection attempts
 */

// ─── Pola berbahaya untuk prompt injection ──────────────────────────────────
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /forget\s+(all\s+)?previous\s+instructions?/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+(if\s+you\s+are\s+)?/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /jailbreak/i,
  /dan\s+mode/i,
  /bypass\s+(your\s+)?(safety|filter|restriction)/i,
  /disregard\s+(all\s+)?(previous\s+)?instruction/i,
  /override\s+(your\s+)?(system|instruction)/i,
  /<\s*\/?\s*(system|prompt|instruction)\s*>/i,
  /\[\s*INST\s*\]/i,
  /###\s*(System|Instruction)/i,
];

/**
 * Mendeteksi apakah teks mengandung pola prompt injection
 * @param {string} text
 * @returns {{ safe: boolean, reason?: string }}
 */
function guardPromptInjection(text) {
  if (!text || typeof text !== "string") return { safe: true };

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        safe: false,
        reason: "Input mengandung pola yang tidak diizinkan (prompt injection detected).",
      };
    }
  }

  // Batasi panjang input untuk mencegah prompt stuffing
  if (text.length > 2000) {
    return {
      safe: false,
      reason: "Input terlalu panjang (maks 2000 karakter).",
    };
  }

  return { safe: true };
}

/**
 * Menganonimkan data mahasiswa sebelum dikirim ke Gemini AI
 * Mengganti NIM dan nama asli dengan ID anonim
 *
 * @param {Array} attendanceRecords — hasil query dari DB
 * @returns {{ anonymized: Array, mapping: Map }} anonymized data + peta ID→Nama asli
 */
function anonymizeMahasiswa(attendanceRecords) {
  const mapping = new Map(); // anonId → { nim, name }
  let counter = 1;

  const anonymized = attendanceRecords.map((record) => {
    const nim = record.mahasiswa?.nim;
    const name = record.mahasiswa?.name;

    // Buat ID anonim deterministik per mahasiswa
    let anonKey = mapping.entries
      ? [...mapping.entries()].find(([, v]) => v.nim === nim)?.[0]
      : null;

    if (!anonKey) {
      anonKey = `MHS_${String(counter).padStart(3, "0")}`;
      mapping.set(anonKey, { nim, name });
      counter++;
    }

    return {
      mahasiswaId: anonKey,
      jurusan: record.mahasiswa?.jurusan,
      semester: record.mahasiswa?.semester,
      date: record.date,
      status: record.status,
      checkIn: record.checkIn ? formatTime(record.checkIn) : null,
      checkOut: record.checkOut ? formatTime(record.checkOut) : null,
    };
  });

  return { anonymized, mapping };
}

/**
 * Format DateTime ke string HH:MM
 */
function formatTime(dt) {
  const d = new Date(dt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

module.exports = { anonymizeMahasiswa, guardPromptInjection };
