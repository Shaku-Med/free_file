# MusicDetector - audio music/speech classifier sidecar (inaSpeechSegmenter).
# CPU-only, private network. Heavier than EmbedAPI because it ships TensorFlow,
# but it only runs on uploads that have audio and is concurrency-capped.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TF_CPP_MIN_LOG_LEVEL=3 \
    PYTHONPATH=/app/src

# ffmpeg: inaSpeechSegmenter decodes and resamples audio through it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-ml.txt ./
RUN pip install -r requirements.txt -r requirements-ml.txt

COPY src ./src

# Load the bundled model at BUILD time: the container downloads nothing at
# runtime, and a broken install fails the build instead of a live request.
RUN python -c "from analyzer import warmup; warmup()"

RUN useradd -r -u 10001 music && chown -R music:music /app
USER music

EXPOSE 3008
CMD ["python", "src/main.py"]
