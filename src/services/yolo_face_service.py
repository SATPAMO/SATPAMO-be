import sys
import json
import base64
import os
import io
from PIL import Image

# Suppress ultralytics verbose logging
os.environ['YOLO_VERBOSE'] = 'False'
from ultralytics import YOLO

current_dir = os.path.dirname(os.path.abspath(__file__))
model_path = os.path.normpath(os.path.join(current_dir, '..', '..', 'models', 'face_yolov8n.pt'))
if not os.path.exists(model_path):
    model_path = os.path.normpath(os.path.join(current_dir, '..', '..', '..', 'sama-mobile', 'face_yolov8n.pt'))

model = YOLO(model_path)

def detect_face(b64_string):
    try:
        if not b64_string:
            return {
                "faceDetected": False,
                "confidence": 0.0,
                "message": "Foto tidak ditemukan."
            }
        
        if ',' in b64_string:
            b64_string = b64_string.split(',', 1)[1]
        
        img_bytes = base64.b64decode(b64_string)
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
        
        results = model.predict(img, conf=0.35, verbose=False)
        boxes = results[0].boxes
        
        if len(boxes) == 0:
            return {
                "faceDetected": False,
                "confidence": 0.0,
                "message": "Wajah tidak terdeteksi oleh YOLO. Pastikan wajah Anda terlihat jelas."
            }
        
        best_conf = float(boxes.conf.max())
        num_faces = len(boxes)
        
        return {
            "faceDetected": True,
            "confidence": round(best_conf, 2),
            "facesCount": num_faces,
            "message": f"Wajah berhasil terdeteksi oleh YOLO ({round(best_conf * 100)}%)."
        }
    except Exception as e:
        return {
            "faceDetected": False,
            "confidence": 0.0,
            "error": str(e),
            "message": f"Gagal menganalisis foto: {str(e)}"
        }

if __name__ == '__main__':
    print(json.dumps({"status": "READY"}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            photo = req.get("photo", "")
            res = detect_face(photo)
            print(json.dumps(res), flush=True)
        except Exception as e:
            print(json.dumps({
                "faceDetected": False,
                "confidence": 0.0,
                "message": f"Error: {str(e)}"
            }), flush=True)
