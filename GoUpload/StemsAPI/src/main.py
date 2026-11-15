"""
StemsAPI - Demucs stem separation sidecar for the player's audio visualizer.

Same trust model as MusicDetector: lives on the private docker network, never
published. Every request must carry X-Internal-Secret; GoUpload is the only
caller, and it posts FLAC as the raw request body. It answers with band
energy curves of the separated stems, not audio, so nothing it returns can be
turned back into the upload.
"""

import asyncio
import hmac
import logging
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request


def _int_env(name: str, default: int, low: int, high: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise SystemExit(f"{name} must be a whole number")
    if not low <= value <= high:
        raise SystemExit(f"{name} must be from {low} to {high}")
    return value


PORT = _int_env("STEMS_API_PORT", 3010, 1, 65535)
SECRET = os.environ.get("STEMS_API_SECRET", "")
MODEL_PATH = os.environ.get("STEMS_MODEL", "")
MODEL_SHA256 = os.environ.get("STEMS_MODEL_SHA256", "")
THREADS = _int_env("STEMS_THREADS", 2, 1, 16)
MAX_SECONDS = _int_env("STEMS_MAX_SECONDS", 1200, 30, 1800)
MAX_QUEUE = _int_env("STEMS_MAX_QUEUE", 2, 0, 16)
MAX_UPLOAD_BYTES = _int_env("STEMS_MAX_UPLOAD_BYTES", 256 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024)

# Torch and BLAS read these when they load; set before the separator imports.
for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, str(THREADS))

logging.basicConfig(level=logging.INFO, format="[stemsapi] %(message)s")
log = logging.getLogger("stemsapi")

if len(SECRET) < 32:
    raise SystemExit("STEMS_API_SECRET must be set (32+ characters) - refusing to start without auth")
if not MODEL_PATH or len(MODEL_SHA256) != 64:
    raise SystemExit("STEMS_MODEL and STEMS_MODEL_SHA256 must be set")

import separator  # noqa: E402

ACCEPT_LIMIT = 1 + MAX_QUEUE
_executor = ThreadPoolExecutor(max_workers=1)
_admit_lock = asyncio.Lock()
_inflight = 0
_model = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _model
    _sweep_stale_tmp()
    started = time.monotonic()
    _model = separator.load_model(MODEL_PATH, MODEL_SHA256)
    log.info(
        "ready: htdemucs loaded in %.1fs threads=%d max=%ds queue=%d port=%d",
        time.monotonic() - started, THREADS, MAX_SECONDS, MAX_QUEUE, PORT,
    )
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def _check_secret(provided: str | None) -> None:
    if not provided or not hmac.compare_digest(provided.encode(), SECRET.encode()):
        log.warning("rejected /separate: missing or wrong X-Internal-Secret")
        raise HTTPException(status_code=401, detail="unauthorized")


def _unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _sweep_stale_tmp(max_age_seconds: int = 3600) -> None:
    tmp = tempfile.gettempdir()
    now = time.time()
    for name in os.listdir(tmp):
        if not name.startswith("st_"):
            continue
        path = os.path.join(tmp, name)
        try:
            if now - os.path.getmtime(path) > max_age_seconds:
                os.unlink(path)
        except OSError:
            pass


async def _spool_to_tmp(request: Request) -> str:
    """The raw body, streamed to disk under the size cap. Not multipart: that
    would be parsed and written out whole before the secret was ever looked at."""
    declared = request.headers.get("content-length")
    if declared is not None and (not declared.isdigit() or int(declared) > MAX_UPLOAD_BYTES):
        raise HTTPException(status_code=413, detail="file too large")
    fd, path = tempfile.mkstemp(prefix="st_", suffix=".flac")
    size = 0
    try:
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="file too large")
                f.write(chunk)
    except Exception:
        _unlink(path)
        raise
    if size == 0:
        _unlink(path)
        raise HTTPException(status_code=400, detail="empty file")
    return path


def _run(path: str) -> dict:
    wav = separator.decode(path, MAX_SECONDS, timeout=600, input_format="flac")
    if wav.shape[1] < separator.FRAME:
        raise ValueError("audio too short")
    return separator.to_json(separator.separate_bands(_model, wav, THREADS))


@app.post("/separate")
async def separate(request: Request, x_internal_secret: str | None = Header(default=None)):
    _check_secret(x_internal_secret)
    if request.headers.get("content-type", "").split(";")[0].strip() != "audio/flac":
        raise HTTPException(status_code=415, detail="send audio/flac")

    global _inflight
    async with _admit_lock:
        if _inflight >= ACCEPT_LIMIT:
            raise HTTPException(status_code=503, detail="busy", headers={"Retry-After": "60"})
        _inflight += 1

    started = time.monotonic()
    path = None
    try:
        path = await _spool_to_tmp(request)
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, _run, path)
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("separate failed after %.1fs: %s", time.monotonic() - started, type(exc).__name__)
        raise HTTPException(status_code=422, detail="could not separate audio")
    finally:
        if path:
            _unlink(path)
        async with _admit_lock:
            _inflight -= 1

    took = time.monotonic() - started
    log.info(
        "separated %.0fs of audio in %.0fs (%.2fx) frames=%d",
        result["duration"], took, result["duration"] / took if took else 0, result["frames"],
    )
    return result


@app.get("/health")
def health():
    return {"status": "ok", "inflight": _inflight}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
