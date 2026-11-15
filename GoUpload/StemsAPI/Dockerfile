# syntax=docker/dockerfile:1.7
# StemsAPI - Demucs (htdemucs) stem separation for the visualizer. CPU only,
# private network, one track at a time, run after an upload has finished.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/src \
    STEMS_MODEL=/opt/stems/955717e8-8726e21a.th \
    STEMS_MODEL_SHA256=8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU build of torch from PyTorch's own index; the PyPI one bundles CUDA.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0

COPY requirements.txt requirements-ml.txt ./
RUN pip install -r requirements.txt \
 && pip install --no-deps -r requirements-ml.txt \
 && pip install cloudpickle==3.1.2 retrying==1.4.2 submitit==1.5.4

# The htdemucs weights, checked against a pinned hash: the build fails rather
# than ship anything else, and the service checks it again before loading.
ADD --checksum=sha256:8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4 \
    https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th /opt/stems/955717e8-8726e21a.th

COPY src ./src

# ADD from a URL leaves the weights readable by root only. Root keeps them so
# the service can read but never change them.
RUN useradd -r -u 10002 stems && chown -R stems:stems /app \
 && chmod 0755 /opt/stems && chmod 0444 /opt/stems/955717e8-8726e21a.th
USER stems

# Load the model as the user that serves it, so a broken install or weights it
# can't read fail the build and not the first upload.
RUN python -c "import separator, os; separator.load_model(os.environ['STEMS_MODEL'], os.environ['STEMS_MODEL_SHA256']); print('htdemucs ok')"

EXPOSE 3010
# Lowest CPU priority: uploads and playback always come first.
CMD ["nice", "-n", "15", "python", "src/main.py"]
