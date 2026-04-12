FROM python:3.12-slim

# Install system libraries required by OpenCV / Ultralytics
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libxcb1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN python manage.py collectstatic --noinput

EXPOSE 8080

CMD python manage.py migrate --noinput && gunicorn core.wsgi:application --bind 0.0.0.0:$PORT --workers 1 --timeout 120
