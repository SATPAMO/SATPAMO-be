# AGENTS.md

Node.js (CommonJS) Express backend (:3001) untuk SATPAMO Presensi. Database MySQL di port 3308 (`sama`), dikelola via Prisma ORM.

## Stack
- Runtime: Node.js (CommonJS, `require`/`module.exports`).
- Framework: Express 5.x (`express`, `express-validator`).
- Database & ORM: MySQL 3308, Prisma 6.x (`@prisma/client`, `prisma`).
- AI & Vision: Google Gemini API (`@google/genai` model `gemini-3.6-flash`).
- Auth & Security: `bcryptjs`, `jsonwebtoken` (JWT).
- Storage & Tools: `multer` (multipart/photo upload), `nodemailer` (SMTP aktivasi), `xlsx` (ekspor rekap).
- Scripts: `npm run dev` (nodemon), `npm run lint` (node --check), `npm test` (native node test runner), `npm run db:push`, `npm run db:seed`.
- Jangan tambah package baru tanpa konfirmasi eksplisit.

## Struktur
- `src/routes/`: Router endpoint REST API (`auth`, `attendance`, `kelas`, `mahasiswa`, `face`, `ai`).
- `src/middleware/`: Auth JWT (`auth.js`), validation, multer upload.
- `src/services/`: External services (`gemini.service.js` vision verification).
- `src/lib/`: Shared helpers (`prisma.js`, `geofence.js`).
- `prisma/`: `schema.prisma`, seed script (`prisma/seed.js`), migrasi.
- `test/`: Native Node test suite (`node --test`).

## Aturan Kerja
- Gunakan CommonJS (`require`/`module.exports`), jangan gunakan ESM (`import`).
- Format response JSON konsisten: `{ success: boolean, message?: string, data?: any }`.
- HTTP status code: `200/201` sukses, `400` validasi, `401/403` auth/geofence, `404` not found, `500` server error.
- Jangan hardcode secrets/credentials; baca dari `process.env`.
- Fix hanya yang diminta, dilarang refactor file lain tanpa instruksi.
- Jangan ubah schema database kecuali task memintanya.
- Respons: 1-2 kalimat padat, direct to the point, tanpa penjelasan bertele-tele.

## Verifikasi
- Jalankan `npm run lint` dan/atau `npm test` sebelum selesai.
