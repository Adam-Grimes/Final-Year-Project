FROM python:3.12-slim

# Install system libraries required by OpenCV / Ultralytics, plus git for pip VCS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libxcb1 \
    libglib2.0-0 \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pre-download the CLIP text encoder weights that YOLOWorld needs for set_classes().
# Baking them into the image avoids a 338 MB download on the first request,
# which would OOM-kill the gunicorn worker on Railway.
ENV YOLO_CONFIG_DIR=/app/.ultralytics
RUN python -c "\
import os; os.environ['YOLO_CONFIG_DIR']='/app/.ultralytics'; \
from ultralytics import YOLOWorld; \
m = YOLOWorld('yolov8l-worldv2.pt'); \
m.set_classes(['food']); \
print('YOLO pre-warm complete')"

EXPOSE 8080

CMD python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn core.wsgi:application --bind 0.0.0.0:$PORT --workers 4 --timeout 120
