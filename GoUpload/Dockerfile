# syntax=docker/dockerfile:1.7
# ── Build stage ──────────────────────────────────────────────
FROM golang:1.25-alpine AS build
WORKDIR /src
# Cache deps first
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/goupload .

# ── ffmpeg stage (single-purpose, small) ─────────────────────
FROM alpine:3.20 AS ffmpeg
RUN apk add --no-cache ffmpeg

# ── whisper.cpp (auto captions) ──────────────────────────────
# Pinned commit (v1.9.5), built for an AVX2 baseline rather than -march=native:
# the image is built on GitHub's runners and has to run on the VPS's CPU.
FROM alpine:3.20 AS whisper
RUN apk add --no-cache build-base cmake git
ARG WHISPER_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
WORKDIR /src/whisper
RUN git init -q . \
 && git remote add origin https://github.com/ggml-org/whisper.cpp.git \
 && git fetch -q --depth 1 origin ${WHISPER_COMMIT} \
 && git checkout -q FETCH_HEAD \
 && cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=ON \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build build --config Release -j"$(nproc)" --target whisper-cli

# The model, checked against a pinned hash: the build fails rather than ship
# anything else. A file ADDed from a URL is root only (600) by default, and
# whisper runs as the app user, so it's made readable. large-v3-turbo has the
# large model's encoder, so it hears far more (and tells languages apart far
# better) than small did, with a small decoder that keeps it about three times
# slower rather than ten.
FROM scratch AS whisper-models
ADD --chmod=644 --checksum=sha256:394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2 \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin /ggml-large-v3-turbo-q5_0.bin

# ── Final ────────────────────────────────────────────────────
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata ffmpeg libstdc++ libgomp \
 && addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/upload /app/upload/temp /app/upload/assembled \
            /app/upload/hls /app/upload/thumbnails /app/upload/temp_processing \
            /app/upload/captions /data/fingerprints \
 && chown -R app:app /app /data
# Before the goupload binary, so a normal deploy doesn't ship the model again.
COPY --from=whisper-models / /opt/whisper/
COPY --from=whisper /src/whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
ENV WHISPER_MODEL=/opt/whisper/ggml-large-v3-turbo-q5_0.bin
WORKDIR /app
COPY --from=build /out/goupload /app/goupload
USER app
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3003/health || exit 1
ENTRYPOINT ["/app/goupload"]
