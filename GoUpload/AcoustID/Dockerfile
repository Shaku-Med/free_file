# AcoustID sidecar — Chromaprint fingerprint + AcoustID lookup for GoUpload.
# Private network only. One Redis consumer; rate-limited to ~3 lookups/sec.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/src

# ffmpeg for decoding; libchromaprint-tools provides fpcalc.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY src ./src

RUN mkdir -p /tmp/acoustid_clips \
 && useradd -r -u 10001 acoustid \
 && chown -R acoustid:acoustid /app /tmp/acoustid_clips

USER acoustid

EXPOSE 3009
CMD ["python", "src/main.py"]
