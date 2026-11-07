const { describe, it } = require("node:test");
const assert = require("node:assert");
const XLSX = require("xlsx");
const {
  isTimeOverlapping,
  normalizeTime,
  parseCsvString,
  parseExcelBuffer,
  checkScheduleConflict,
} = require("../src/lib/scheduleValidator");

describe("scheduleValidator Unit Tests", () => {
  it("should correctly detect overlapping time intervals (Arrange-Act-Assert)", () => {
    // Arrange
    const startA = "08:00";
    const endA = "10:30";
    const startB = "09:00";
    const endB = "11:00";

    // Act
    const result = isTimeOverlapping(startA, endA, startB, endB);

    // Assert
    assert.strictEqual(result, true);
  });

  it("should return false for back-to-back non-overlapping intervals", () => {
    // Arrange
    const startA = "08:00";
    const endA = "10:00";
    const startB = "10:00";
    const endB = "12:00";

    // Act
    const result = isTimeOverlapping(startA, endA, startB, endB);

    // Assert
    assert.strictEqual(result, false);
  });

  it("should normalize time format correctly to HH:mm", () => {
    // Arrange & Act
    const normalized1 = normalizeTime("8:00");
    const normalized2 = normalizeTime("08:30");
    const invalid = normalizeTime("25:99");

    // Assert
    assert.strictEqual(normalized1, "08:00");
    assert.strictEqual(normalized2, "08:30");
    assert.strictEqual(invalid, null);
  });

  it("should parse CSV string with headers and values", () => {
    // Arrange
    const csvContent =
      "kode_kelas,nama_kelas,hari,jam_mulai,jam_selesai,ruangan,nim,nama_mahasiswa\n" +
      "IF101,Algoritma,SENIN,08:00,10:30,Lab 1,2024001,Budi\n" +
      "IF101,Algoritma,SENIN,08:00,10:30,Lab 1,2024002,Siti";

    // Act
    const rows = parseCsvString(csvContent);

    // Assert
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].kode_kelas, "IF101");
    assert.strictEqual(rows[0].nim, "2024001");
    assert.strictEqual(rows[1].nim, "2024002");
  });

  it("should parse Excel (.xlsx) buffer into normalized row objects", () => {
    // Arrange
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Kode Kelas", "Nama Kelas", "Hari", "Jam Mulai", "Jam Selesai", "Ruangan", "NIM", "Nama Mahasiswa"],
      ["IF201", "Basis Data", "SELASA", "13:00", "15:30", "R302", "2024003", "Rizky"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Act
    const rows = parseExcelBuffer(buffer);

    // Assert
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kode_kelas, "IF201");
    assert.strictEqual(rows[0].nama_kelas, "Basis Data");
    assert.strictEqual(rows[0].nim, "2024003");
  });

  it("should detect conflict when Dosen already has another schedule at the same time", async () => {
    // Arrange
    const mockPrisma = {
      jadwalKelas: {
        findMany: async ({ where }) => {
          if (where.kelas?.dosenId) {
            return [
              {
                id: "j1",
                hari: "SENIN",
                jamMulai: "08:00",
                jamSelesai: "10:30",
                kelas: { id: "k1", kode: "IF101", nama: "Algoritma" },
              },
            ];
          }
          return [];
        },
      },
    };

    // Act
    const conflictResult = await checkScheduleConflict(mockPrisma, {
      dosenId: "dosen-123",
      hari: "SENIN",
      jamMulai: "09:00",
      jamSelesai: "11:00",
      ruangan: "Lab 2",
    });

    // Assert
    assert.strictEqual(conflictResult.hasConflict, true);
    assert.strictEqual(conflictResult.type, "DOSEN_CONFLICT");
  });

  it("should detect conflict when Room is already in use by another class at the same time", async () => {
    // Arrange
    const mockPrisma = {
      jadwalKelas: {
        findMany: async ({ where }) => {
          if (where.ruangan) {
            return [
              {
                id: "j2",
                hari: "SENIN",
                jamMulai: "08:00",
                jamSelesai: "10:30",
                ruangan: "Lab 1",
                kelas: { id: "k2", kode: "IF201", nama: "Basis Data", dosen: { username: "dosen_lain" } },
              },
            ];
          }
          return [];
        },
      },
    };

    // Act
    const conflictResult = await checkScheduleConflict(mockPrisma, {
      dosenId: "dosen-123",
      hari: "SENIN",
      jamMulai: "09:00",
      jamSelesai: "11:00",
      ruangan: "Lab 1",
    });

    // Assert
    assert.strictEqual(conflictResult.hasConflict, true);
    assert.strictEqual(conflictResult.type, "ROOM_CONFLICT");
  });
});

