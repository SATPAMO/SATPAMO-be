/**
 * prisma/seed.js
 * Data awal untuk development: mahasiswa contoh + kehadiran minggu ini
 * Jalankan: node prisma/seed.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database SAMA...\n");

  // ─── 1. Buat akun Dosen Admin ─────────────────────────────────────────────
  const hashedPassword = await bcrypt.hash("admin123", 12);
  const admin = await prisma.dosen.upsert({
    where: { email: "admin@sama.ac.id" },
    update: {},
    create: {
      username: "admin",
      email: "admin@sama.ac.id",
      password: hashedPassword,
      role: "ADMIN",
    },
  });
  console.log(`✅ Dosen Admin: ${admin.email} (password: admin123)`);

  const dosen1 = await prisma.dosen.upsert({
    where: { email: "budi.santoso@sama.ac.id" },
    update: {},
    create: {
      username: "budi_santoso",
      email: "budi.santoso@sama.ac.id",
      password: await bcrypt.hash("dosen123", 12),
      role: "DOSEN",
    },
  });
  console.log(`✅ Dosen: ${dosen1.email} (password: dosen123)`);

  // ─── 2. Buat data Mahasiswa ───────────────────────────────────────────────
  const mahasiswaPassword = "mahasiswa123";
  const mahasiswaHashedPassword = await bcrypt.hash(mahasiswaPassword, 12);

  const mahasiswaData = [
    { nim: "2021001001", name: "Ahmad Rizki Pratama",    email: "ahmad.rizki@mhs.sama.ac.id",    jurusan: "Teknik Informatika", semester: 7, password: mahasiswaHashedPassword },
    { nim: "2021001002", name: "Siti Nurhaliza",         email: "siti.nurhaliza@mhs.sama.ac.id", jurusan: "Teknik Informatika", semester: 7, password: mahasiswaHashedPassword },
    { nim: "2021001003", name: "Budi Cahyono",           email: "budi.cahyono@mhs.sama.ac.id",   jurusan: "Teknik Informatika", semester: 7, password: mahasiswaHashedPassword },
    { nim: "2021001004", name: "Dewi Rahayu",            email: "dewi.rahayu@mhs.sama.ac.id",    jurusan: "Teknik Informatika", semester: 7, password: mahasiswaHashedPassword },
    { nim: "2021001005", name: "Eko Prasetyo",           email: "eko.prasetyo@mhs.sama.ac.id",   jurusan: "Teknik Informatika", semester: 7, password: mahasiswaHashedPassword },
    { nim: "2022002001", name: "Fatimah Zahra",          email: "fatimah.zahra@mhs.sama.ac.id",  jurusan: "Sistem Informasi",   semester: 5, password: mahasiswaHashedPassword },
    { nim: "2022002002", name: "Gilang Ramadhan",        email: "gilang.r@mhs.sama.ac.id",       jurusan: "Sistem Informasi",   semester: 5, password: mahasiswaHashedPassword },
    { nim: "2022002003", name: "Hana Pertiwi",           email: "hana.p@mhs.sama.ac.id",         jurusan: "Sistem Informasi",   semester: 5, password: mahasiswaHashedPassword },
    { nim: "2022002004", name: "Irfan Hakim",            email: "irfan.h@mhs.sama.ac.id",        jurusan: "Sistem Informasi",   semester: 5, password: mahasiswaHashedPassword },
    { nim: "2023003001", name: "Jasmine Aulia",          email: "jasmine.a@mhs.sama.ac.id",      jurusan: "Teknik Elektro",     semester: 3, password: mahasiswaHashedPassword },
    { nim: "2023003002", name: "Kevin Surya",            email: "kevin.s@mhs.sama.ac.id",        jurusan: "Teknik Elektro",     semester: 3, password: mahasiswaHashedPassword },
    { nim: "2023003003", name: "Lestari Wulandari",      email: "lestari.w@mhs.sama.ac.id",      jurusan: "Teknik Elektro",     semester: 3, password: mahasiswaHashedPassword },
  ];

  const mahasiswas = [];
  for (const data of mahasiswaData) {
    const mhs = await prisma.mahasiswa.upsert({
      where: { nim: data.nim },
      update: { password: mahasiswaHashedPassword },
      create: data,
    });
    mahasiswas.push(mhs);
  }
  console.log(`✅ ${mahasiswas.length} mahasiswa berhasil dibuat (password: ${mahasiswaPassword})`);

  // ─── 3. Buat data Kehadiran 7 hari terakhir ────────────────────────────────
  await prisma.attendance.deleteMany();
  console.log("🧹 Data kehadiran lama dibersihkan");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const statusPool = ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "LATE", "ABSENT", "IZIN"];

  let attendanceCount = 0;
  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    const dateStr = d.toISOString().split("T")[0];
    const date = new Date(`${dateStr}T00:00:00.000Z`);

    // Skip weekend
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    for (const mhs of mahasiswas) {
      const status = statusPool[Math.floor(Math.random() * statusPool.length)];

      const checkInBase = new Date(date);
      checkInBase.setHours(7, 45, 0, 0);

      let checkIn = null;
      let checkOut = null;

      if (status === "PRESENT") {
        checkIn = new Date(checkInBase.getTime() + Math.random() * 15 * 60000); // 07:45 - 08:00
        checkOut = new Date(date);
        checkOut.setHours(16, 30 + Math.floor(Math.random() * 30), 0, 0);
      } else if (status === "LATE") {
        checkIn = new Date(checkInBase.getTime() + (15 + Math.random() * 45) * 60000); // 08:00 - 08:45
        checkOut = new Date(date);
        checkOut.setHours(17, 0 + Math.floor(Math.random() * 30), 0, 0);
      }

      const existing = await prisma.attendance.findFirst({
        where: { mahasiswaId: mhs.id, date },
      });

      if (!existing) {
        await prisma.attendance.create({
          data: {
            mahasiswaId: mhs.id,
            date,
            status,
            checkIn,
            checkOut,
          },
        });
        attendanceCount++;
      }
    }
  }

  console.log(`✅ ${attendanceCount} record kehadiran berhasil dibuat (7 hari terakhir)\n`);
  console.log("🎉 Seeding selesai!\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("   Login sebagai Admin: admin@sama.ac.id / admin123");
  console.log("   Login sebagai Dosen: budi.santoso@sama.ac.id / dosen123");
  console.log(`   Login Mahasiswa (mobile): email/NIM / ${mahasiswaPassword}`);
  console.log("   Contoh: 2021001001 / mahasiswa123");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
