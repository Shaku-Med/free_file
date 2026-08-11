# AcoustID sidecar

Private fingerprint + song-ID service for GoUpload. GoUpload does **not**
expose any AcoustID HTTP routes — it only calls this sidecar over the private
docker network (same pattern as MusicDetector / NSFWAPI).

Flow: GoUpload posts a short MP3 clip → this service `RPUSH`es Redis list
`acoustid_jobs` → one consumer `BLPOP`s → Chromaprint + AcoustID lookup →
result stored in Redis (`acoustid:result:{upload_id}`) → webhook to the app.

Never published to the internet — private `goupload-net` only (no host ports).

## Endpoints (sidecar only)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/health` | none | readiness |
| POST | `/identify` | `X-Internal-Secret` | multipart clip → **202** queued |
| POST | `/cancel` | `X-Internal-Secret` | drop queued / abort in-flight by `job_id` |

## Env

See `../acoustid.env.example`. Compose forces `ACOUSTID_API_PORT=3009`.

## Local image build

```bash
docker build -t goupload-acoustid ./AcoustID
```
