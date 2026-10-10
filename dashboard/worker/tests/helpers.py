from pathlib import Path

WORKER = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / 'fixtures'
MODEL_URL = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx'
MODEL_SHA256 = 'c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d'
# USFWS photo (public domain), resized to 320x240 (dashboard/worker/tests/fixtures/README.txt).
FIXTURE_SHA256 = 'b28e927737026ff66e666e1011952adf0efadda119c335143b7c9b84d6fc2ae2'
