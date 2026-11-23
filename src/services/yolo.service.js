const { spawn } = require("child_process");
const path = require("path");

let pythonProcess = null;
let isReady = false;
const queue = [];

function initYoloProcess() {
  if (pythonProcess) return;

  const scriptPath = path.join(__dirname, "yolo_face_service.py");
  console.log("[YOLO] Inisialisasi model YOLO face detection...");

  try {
    pythonProcess = spawn("python", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuffer = "";

    pythonProcess.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.status === "READY") {
            isReady = true;
            console.log("✅ [YOLO] Model YOLOv8-Face siap digunakan!");
            continue;
          }

          if (queue.length > 0) {
            const { resolve } = queue.shift();
            resolve(parsed);
          }
        } catch (err) {
          console.error("[YOLO] Error parsing output:", trimmed);
        }
      }
    });

    pythonProcess.stderr.on("data", (chunk) => {
      const errStr = chunk.toString().trim();
      if (errStr && !errStr.includes("UserWarning") && !errStr.includes("Ultralytics")) {
        console.warn("[YOLO]", errStr);
      }
    });

    pythonProcess.on("exit", (code) => {
      console.warn(`[YOLO] Python process keluar dengan kode ${code}.`);
      pythonProcess = null;
      isReady = false;
      while (queue.length > 0) {
        const { reject } = queue.shift();
        reject(new Error("YOLO process exited unexpectedly."));
      }
    });
  } catch (err) {
    console.error("[YOLO] Gagal spawn python:", err.message);
  }
}

initYoloProcess();

async function verifyFaceWithYolo(photoBase64) {
  if (!pythonProcess) {
    initYoloProcess();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const idx = queue.findIndex((item) => item.resolve === resolve);
      if (idx !== -1) queue.splice(idx, 1);
      resolve({
        faceDetected: false,
        confidence: 0.0,
        message: "Waktu verifikasi YOLO habis (timeout).",
      });
    }, 15000);

    queue.push({
      resolve: (data) => {
        clearTimeout(timeout);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    try {
      const payload = JSON.stringify({ photo: photoBase64 }) + "\n";
      pythonProcess.stdin.write(payload);
    } catch (writeErr) {
      clearTimeout(timeout);
      reject(writeErr);
    }
  });
}

module.exports = { verifyFaceWithYolo };
