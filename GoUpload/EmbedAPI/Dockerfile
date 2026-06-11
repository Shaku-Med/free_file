# EmbedAPI - local embedding sidecar. ~300MB image, no torch, CPU-only.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # fastembed model cache lives inside the image (baked at build) so the
    # container never downloads anything at runtime = works with no egress.
    FASTEMBED_CACHE_PATH=/opt/fastembed-cache \
    HF_HUB_DISABLE_TELEMETRY=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Bake the model into the image at BUILD time.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

COPY main.py .

# Non-root, read-only friendly.
RUN useradd -r -u 10001 embed && chown -R embed:embed /opt/fastembed-cache
USER embed

EXPOSE 3007
CMD ["python", "main.py"]
