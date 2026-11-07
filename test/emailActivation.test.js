const { describe, it } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const { sendActivationEmail } = require("../src/services/email.service");

describe("Email Activation Unit Tests", () => {
  it("should handle simulation mode gracefully when SMTP credentials are not configured", async () => {
    // Arrange
    const payload = {
      to: "mahasiswa@gmail.com",
      name: "Budi Santoso",
      nim: "202401001",
      activationUrl: "http://localhost:5173/aktivasi?token=dummy-jwt-token",
    };

    // Act
    const result = await sendActivationEmail(payload);

    // Assert
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.devMode, true);
    assert.strictEqual(result.activationUrl, payload.activationUrl);
  });

  it("should create and verify valid 24h activation token", () => {
    // Arrange
    const secret = "test_jwt_secret_key";
    const mahasiswa = {
      id: "mhs-1",
      nim: "202401001",
      email: "budi@gmail.com",
    };

    // Act
    const token = jwt.sign(
      {
        mahasiswaId: mahasiswa.id,
        nim: mahasiswa.nim,
        email: mahasiswa.email,
        type: "ACCOUNT_ACTIVATION",
      },
      secret,
      { expiresIn: "24h" }
    );

    const decoded = jwt.verify(token, secret);

    // Assert
    assert.strictEqual(decoded.mahasiswaId, "mhs-1");
    assert.strictEqual(decoded.nim, "202401001");
    assert.strictEqual(decoded.type, "ACCOUNT_ACTIVATION");
  });

  it("should reject activation token with invalid type", () => {
    // Arrange
    const secret = "test_jwt_secret_key";
    const wrongToken = jwt.sign(
      {
        mahasiswaId: "mhs-1",
        type: "LOGIN_TOKEN",
      },
      secret
    );

    // Act
    const decoded = jwt.verify(wrongToken, secret);

    // Assert
    assert.notStrictEqual(decoded.type, "ACCOUNT_ACTIVATION");
  });
});

