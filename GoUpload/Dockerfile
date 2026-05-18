# syntax=docker/dockerfile:1.7
# ── Build stage ──────────────────────────────────────────────
FROM golang:1.24-alpine AS build
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

# ── Final ────────────────────────────────────────────────────
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata ffmpeg \
 && addgroup -S app && adduser -S app -G app \
 && mkdir -p /app/upload /app/upload/temp /app/upload/assembled \
            /app/upload/hls /app/upload/thumbnails /app/upload/temp_processing \
 && chown -R app:app /app
WORKDIR /app
COPY --from=build /out/goupload /app/goupload
USER app
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3003/health || exit 1
ENTRYPOINT ["/app/goupload"]
