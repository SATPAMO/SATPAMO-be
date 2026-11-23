const express = require("express");
const router = express.Router();
const { verifyFaceWithYolo } = require("../services/yolo.service");

// ─── POST /api/face/verify ───────────────────────────────────────────────────
// Memvalidasi foto selfie mahasiswa dengan model YOLOv8-Face
router.post("/verify", async (req, res) => {
  const { photo } = req.body;
  if (!photo) {
    return res.status(400).json({
      success: false,
      faceDetected: false,
      confidence: 0.0,
      message: "Foto selfie wajib disertakan.",
    });
  }

  try {
    const result = await verifyFaceWithYolo(photo);
    return res.json({
      success: true,
      faceDetected: result.faceDetected ?? false,
      confidence: result.confidence ?? 0.0,
      facesCount: result.facesCount ?? (result.faceDetected ? 1 : 0),
      message: result.message || (result.faceDetected ? "Wajah terdeteksi." : "Wajah tidak terdeteksi."),
    });
  } catch (err) {
    console.error("[FACE ROUTE] Error:", err.message);
    return res.status(500).json({
      success: false,
      faceDetected: false,
      confidence: 0.0,
      message: "Gagal memproses verifikasi wajah YOLO: " + err.message,
    });
  }
});

module.exports = router;
