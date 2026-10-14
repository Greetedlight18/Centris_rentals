FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Xvfb lets Chromium run in headed mode (SCRAPE_HEADLESS=false), which is
# noticeably harder for anti-bot systems to fingerprint than headless.
RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY main.py .

RUN mkdir -p /app/debug

CMD ["xvfb-run", "-a", "--server-args=-screen 0 1920x1080x24", "python", "-u", "main.py"]