const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const mahasiswas = await prisma.mahasiswa.findMany({
    select: { id: true, nim: true, name: true, email: true },
  });
  const kelas = await prisma.kelas.findMany({
    include: { jadwals: true, mahasiswas: true },
  });
  const attendances = await prisma.attendance.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  console.log("=== MAHASISWAS ===");
  console.log(JSON.stringify(mahasiswas, null, 2));

  console.log("=== KELAS ===");
  console.log(JSON.stringify(kelas.map(k => ({
    id: k.id,
    nama: k.nama,
    kode: k.kode,
    mahasiswaCount: k.mahasiswas.length,
    jadwals: k.jadwals
  })), null, 2));

  console.log("=== RECENT ATTENDANCES ===");
  console.log(JSON.stringify(attendances, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
