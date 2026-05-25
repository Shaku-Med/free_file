# syntax=docker/dockerfile:1.7
# ── Build ─────────────────────────────────────────────
FROM golang:1.24-alpine AS build
WORKDIR /src
# loadplay shares the goupload go.mod (parent dir), so the build context
# must be the GoUpload root and the Dockerfile path is loadplay/Dockerfile.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/loadplay ./loadplay

# ── Final ─────────────────────────────────────────────
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /out/loadplay /app/loadplay
USER app
EXPOSE 3006
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3006/health || exit 1
ENTRYPOINT ["/app/loadplay"]
