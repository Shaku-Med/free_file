"""
AcoustID sidecar — private fingerprint + lookup service for GoUpload.

Lives on the docker network only (never published). GoUpload POSTs a small
MP3 clip; we enqueue it on Redis and process ONE job at a time so we stay
inside AcoustID's ~3 lookups/sec rate limit. Results go to the app webhook.
"""

from __future__ import annotations

import hmac
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

import acoustid_client as ac
import config
import worker

logging.basicConfig(level=logging.INFO, format="[acoustid] %(message)s")
log = logging.getLogger("acoustid")

if problem := config.missing_config():
    raise SystemExit(f"{problem} - refusing to start")

# Without a secret the server falls back to loopback. Bare local runs want that,
# but in a container it still passes the healthcheck while being unreachable from
# goupload, so uploads would silently never get identified. Make it fatal.
if os.path.exists("/.dockerenv") and not config.SECRET:
    raise SystemExit("ACOUSTID_API_SECRET is not set - refusing to start")


@asynccontextmanager
async def lifespan(_: FastAPI):
    os.makedirs(config.CLIPS_DIR, mode=0o700, exist_ok=True)
    _sweep_stale_clips()
    worker.start_background()
    log.info(
        "ready port=%d fpcalc=%s queue=%s",
        config.PORT,
        "yes" if ac.fpcalc_available() else "MISSING",
        config.REDIS_QUEUE,
    )
    yield
    worker.stop()
    log.info("shutting down")


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def _check_secret(provided: str | None) -> None:
    # No secret configured (local AcoustID/.env only has the API key): allow.
    # Compose injects ACOUSTID_API_SECRET and GoUpload always sends the header.
    if not config.SECRET:
        return
    if not provided or not hmac.compare_digest(provided, config.SECRET):
        log.warning("rejected: missing or wrong X-Internal-Secret")
        raise HTTPException(status_code=401, detail="unauthorized")


def _unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _sweep_stale_clips(max_age_seconds: int = 3600) -> None:
    now = time.time()
    removed = 0
    try:
        for name in os.listdir(config.CLIPS_DIR):
            path = os.path.join(config.CLIPS_DIR, name)
            try:
                if now - os.path.getmtime(path) > max_age_seconds:
                    os.unlink(path)
                    removed += 1
            except OSError:
                pass
    except OSError:
        return
    if removed:
        log.info("cleaned %d stale clip(s)", removed)


def _suffix_for(name: str | None) -> str:
    ext = Path(name or "").suffix.lower()
    if ext in config.ALLOWED_SUFFIXES:
        return ext
    return ".mp3"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "api_key_set": bool(config.ACOUSTID_API_KEY),
        "fpcalc_found": ac.fpcalc_available(),
        "queue": config.REDIS_QUEUE,
        "min_score": config.MATCH_MIN_SCORE,
    }


@app.post("/identify")
async def identify(
    file: UploadFile = File(...),
    job_id: str = Form(...),
    upload_id: str = Form(...),
    unique_id: str = Form(""),
    user_id: str = Form(""),
    storage_prefix: str = Form(""),
    clip_start: float = Form(0.0),
    clip_end: float = Form(0.0),
    source_duration: float = Form(0.0),
    title_hint: str = Form(""),
    x_internal_secret: str | None = Header(default=None),
):
    _check_secret(x_internal_secret)

    jid = (job_id or "").strip()
    uid = (upload_id or "").strip()
    if not jid or not uid:
        raise HTTPException(status_code=400, detail="job_id and upload_id required")

    if not ac.fpcalc_available():
        raise HTTPException(status_code=503, detail="fpcalc not installed")

    suffix = _suffix_for(file.filename)
    clip_name = f"{jid}_{uuid.uuid4().hex}{suffix}"
    clip_path = os.path.join(config.CLIPS_DIR, clip_name)

    written = 0
    try:
        with open(clip_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > config.MAX_UPLOAD_BYTES:
                    _unlink(clip_path)
                    raise HTTPException(status_code=413, detail="file too large")
                out.write(chunk)
    except HTTPException:
        raise
    except Exception:
        _unlink(clip_path)
        raise

    if written == 0:
        _unlink(clip_path)
        raise HTTPException(status_code=400, detail="empty file")

    job = {
        "job_id": jid,
        "upload_id": uid,
        "unique_id": (unique_id or uid).strip() or uid,
        "user_id": (user_id or "").strip(),
        "storage_prefix": (storage_prefix or "").strip(),
        "clip_path": clip_path,
        "clip_start": float(clip_start or 0),
        "clip_end": float(clip_end or 0),
        "source_duration": int(float(source_duration or 0)),
        # Upload title/filename — break ties when AcoustID returns several
        # same-score MusicBrainz recordings (covers / same song name).
        "title_hint": (title_hint or "").strip()[:300],
        "enqueued_at": time.time(),
    }
    try:
        worker.enqueue(job)
    except Exception as exc:
        _unlink(clip_path)
        log.warning("enqueue failed job_id=%s: %s", jid, exc)
        raise HTTPException(status_code=503, detail="queue unavailable") from exc

    log.info(
        "enqueued job_id=%s upload=%s size=%dB window=%.1f-%.1f source_dur=%s",
        jid,
        uid,
        written,
        float(clip_start or 0),
        float(clip_end or 0),
        int(float(source_duration or 0)),
    )
    return JSONResponse(
        {"ok": True, "queued": True, "job_id": jid, "upload_id": uid},
        status_code=202,
    )


@app.post("/cancel")
async def cancel(
    job_id: str = Form(...),
    x_internal_secret: str | None = Header(default=None),
):
    _check_secret(x_internal_secret)
    jid = (job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id required")
    worker.request_cancel(jid)
    return {"ok": True, "cancelled": jid}


if __name__ == "__main__":
    import uvicorn

    # Local .env has only the AcoustID key → localhost only. Compose sets a
    # secret and runs under docker where 0.0.0.0 is fine (private network).
    host = "0.0.0.0" if config.SECRET else "127.0.0.1"
    uvicorn.run(app, host=host, port=config.PORT, log_level="warning")
