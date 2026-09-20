require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

// Singleton pattern — satu instance Prisma di seluruh aplikasi
const prisma = global.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

module.exports = prisma;
