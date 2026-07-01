"""
MusicDetector - local music/speech classifier sidecar (inaSpeechSegmenter).

Same trust model as EmbedAPI: lives on the private docker network, never
published to the internet. Every request must carry X-Internal-Secret; GoUpload
is the only caller. It decides files.is_music from the fraction of the track
that is actually music, so a clip with only background music under speech is not
flagged. AcoustID stays for metadata; this service never touches the DB.
"""

import asyncio
import hmac
import logging
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Header, HTTPException, UploadFile


def _load_env_files() -> None:
    """Tiny stdlib .env loader for bare `python src/main.py` runs (no-op under docker).

    Reads MusicDetector/.env first, then GoUpload/.env (where MUSIC_API_SECRET
    lives, the same file compose interpolates). Real env vars always win.
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for path in (os.path.join(root, ".env"), os.path.join(root, "..", ".env")):
        try:
            with open(path, encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
        except OSError:
            continue


_load_env_files()

PORT = int(os.environ.get("MUSIC_API_PORT", "3008"))
SECRET = os.environ.get("MUSIC_API_SECRET", "")
RATIO_THRESHOLD = float(os.environ.get("MUSIC_RATIO_THRESHOLD", "0.8"))
MIN_MUSIC_SECONDS = float(os.environ.get("MUSIC_MIN_SECONDS", "15"))
ANALYZE_MAX_SECONDS = float(os.environ.get("MUSIC_ANALYZE_MAX_SECONDS", "180"))
MAX_CONCURRENCY = max(1, int(os.environ.get("MUSIC_CONCURRENCY", "1")))
MAX_QUEUE = max(0, int(os.environ.get("MUSIC_MAX_QUEUE", "8")))
MAX_UPLOAD_BYTES = int(os.environ.get("MUSIC_MAX_UPLOAD_BYTES", str(256 * 1024 * 1024)))

# Keep TF/BLAS from grabbing every core on a shared VPS. Set before any heavy
# import reads them.
_threads = os.environ.get("MUSIC_THREADS", "1")
for _var in (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "TF_NUM_INTRAOP_THREADS",
    "TF_NUM_INTEROP_THREADS",
):
    os.environ.setdefault(_var, _threads)
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

logging.basicConfig(level=logging.INFO, format="[musicdetector] %(message)s")
log = logging.getLogger("musicdetector")

if not SECRET:
    raise SystemExit("MUSIC_API_SECRET must be set - refusing to start without auth")

from analyzer import analyze_file, decide_is_music, is_stub  # noqa: E402

ACCEPT_LIMIT = MAX_CONCURRENCY + MAX_QUEUE
_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENCY)
_admit_lock = asyncio.Lock()
_inflight = 0


@asynccontextmanager
async def lifespan(_: FastAPI):
    from analyzer import warmup

    log.info("starting: loading model (this can take a few seconds)...")
    _sweep_stale_tmp()
    warmup()
    log.info(
        "ready: mode=%s ratio>=%.2f min_music=%.0fs cap=%.0fs concurrency=%d queue=%d port=%d",
        "STUB" if is_stub() else "model",
        RATIO_THRESHOLD,
        MIN_MUSIC_SECONDS,
        ANALYZE_MAX_SECONDS,
        MAX_CONCURRENCY,
        MAX_QUEUE,
        PORT,
    )
    yield
    log.info("shutting down")


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def _check_secret(provided: str | None) -> None:
    if not provided or not hmac.compare_digest(provided, SECRET):
        log.warning("rejected /analyze: missing or wrong X-Internal-Secret")
        raise HTTPException(status_code=401, detail="unauthorized")


def _unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _sweep_stale_tmp(max_age_seconds: int = 3600) -> None:
    # Remove leftover md_* spool files from a previous crash so they can't pile up.
    # Each request normally deletes its own clip in a finally block.
    tmp = tempfile.gettempdir()
    now = time.time()
    removed = 0
    try:
        for name in os.listdir(tmp):
            if not name.startswith("md_"):
                continue
            path = os.path.join(tmp, name)
            try:
                if now - os.path.getmtime(path) > max_age_seconds:
                    os.unlink(path)
                    removed += 1
            except OSError:
                pass
    except OSError:
        return
    if removed:
        log.info("cleaned %d stale temp file(s)", removed)


def _suffix_for(name: str | None) -> str:
    ext = os.path.splitext(name or "")[1].lower()
    if 1 < len(ext) <= 6 and ext.isascii() and ext[1:].isalnum():
        return ext
    return ".bin"


async def _spool_to_tmp(upload: UploadFile) -> str:
    fd, path = tempfile.mkstemp(prefix="md_", suffix=_suffix_for(upload.filename))
    size = 0
    try:
        with os.fdopen(fd, "wb") as f:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    log.warning("rejected %r: larger than %d bytes", upload.filename, MAX_UPLOAD_BYTES)
                    raise HTTPException(status_code=413, detail="file too large")
                f.write(chunk)
    except Exception:
        _unlink(path)
        raise
    if size == 0:
        _unlink(path)
        log.warning("rejected %r: empty file", upload.filename)
        raise HTTPException(status_code=400, detail="empty file")
    return path


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    x_internal_secret: str | None = Header(default=None),
):
    _check_secret(x_internal_secret)

    name = (file.filename or "?")[:120]

    global _inflight
    async with _admit_lock:
        if _inflight >= ACCEPT_LIMIT:
            log.warning("overloaded: rejecting %r (inflight=%d limit=%d)", name, _inflight, ACCEPT_LIMIT)
            raise HTTPException(
                status_code=503, detail="overloaded", headers={"Retry-After": "5"}
            )
        _inflight += 1

    started = time.monotonic()
    path = None
    try:
        path = await _spool_to_tmp(file)
        log.info("analyze start file=%r size=%dB inflight=%d", name, os.path.getsize(path), _inflight)
        loop = asyncio.get_running_loop()
        summary = await loop.run_in_executor(
            _executor, analyze_file, path, ANALYZE_MAX_SECONDS or None
        )
    except HTTPException:
        raise
    except Exception as exc:
        log.warning("analyze FAILED file=%r after %.1fs: %s", name, time.monotonic() - started, exc)
        raise HTTPException(status_code=422, detail="could not analyze audio")
    finally:
        if path:
            _unlink(path)
        async with _admit_lock:
            _inflight -= 1

    is_music = decide_is_music(summary, RATIO_THRESHOLD, MIN_MUSIC_SECONDS)
    log.info(
        "analyze done file=%r is_music=%s ratio=%.3f music=%.1fs voiced=%.1fs took=%.1fs%s",
        name,
        is_music,
        summary["music_ratio"],
        summary["music_seconds"],
        summary["voiced_seconds"],
        time.monotonic() - started,
        " [STUB]" if is_stub() else "",
    )
    return {
        "is_music": is_music,
        **summary,
        "threshold": RATIO_THRESHOLD,
        "min_music_seconds": MIN_MUSIC_SECONDS,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "stub": is_stub(),
        "inflight": _inflight,
        "accept_limit": ACCEPT_LIMIT,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
