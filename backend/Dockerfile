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

EXPOSE 8080

# migrate, collectstatic and gunicorn all run at container start so that
# SECRET_KEY and DATABASE_URL environment variables are available.
CMD python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn core.wsgi:application --bind 0.0.0.0:$PORT --workers 1 --timeout 120
