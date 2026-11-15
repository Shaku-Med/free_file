# syntax=docker/dockerfile:1.7
# MusicDetector - audio music/speech classifier sidecar (inaSpeechSegmenter),
# plus YAMNet sound tags for captions. CPU-only, private network. Heavier than
# EmbedAPI because it ships TensorFlow, but it only runs on uploads that have
# audio and is concurrency-capped.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TF_CPP_MIN_LOG_LEVEL=3 \
    PYTHONPATH=/app/src \
    SOUNDS_MODEL=/opt/yamnet

# ffmpeg: inaSpeechSegmenter decodes and resamples audio through it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-ml.txt ./
RUN pip install -r requirements.txt -r requirements-ml.txt

# YAMNet (Google's AudioSet classifier, a TF SavedModel), checked against a
# pinned hash: the build fails rather than ship anything else. The archive's
# files are root only, so they're made readable for the service user.
ADD --checksum=sha256:b80da2a1a56926fb0767205051a200dd7b3beaf3ea1ea126c42a53943996e5e0 \
    https://www.kaggle.com/api/v1/models/google/yamnet/tensorFlow2/yamnet/1/download /tmp/yamnet.tar.gz
RUN mkdir -p /opt/yamnet \
 && tar -xzf /tmp/yamnet.tar.gz -C /opt/yamnet --no-same-owner \
 && rm /tmp/yamnet.tar.gz \
 && chmod -R u=rwX,go=rX /opt/yamnet

COPY src ./src

# Load the bundled model at BUILD time: the container downloads nothing at
# runtime, and a broken install fails the build instead of a live request.
RUN python -c "from analyzer import warmup; warmup()"

RUN useradd -r -u 10001 music && chown -R music:music /app
USER music

EXPOSE 3008
CMD ["python", "src/main.py"]
