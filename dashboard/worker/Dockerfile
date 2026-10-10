FROM python:3.12.15-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# YOLOX-nano (Megvii, Apache-2.0), official ONNX release. The build fails unless the file matches this SHA-256.
ARG MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx
ARG MODEL_SHA256=c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d
RUN mkdir -p /app/models \
    && python -c "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$MODEL_URL" /app/models/yolox_nano.onnx \
    && echo "$MODEL_SHA256  /app/models/yolox_nano.onnx" | sha256sum -c -
COPY . .
RUN useradd --system --no-create-home worker
USER worker
CMD ["python", "-m", "nesttrace_worker.main"]
