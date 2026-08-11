"""Environment-only configuration for the AcoustID sidecar."""

from __future__ import annotations

import os


def _load_env_files() -> None:
    """Stdlib .env loader for bare `python src/main.py` (no-op under docker).

    Reads AcoustID/.env first, then GoUpload/.env. Real process env always wins.
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


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


PORT = _int("ACOUSTID_API_PORT", 3009)
SECRET = os.getenv("ACOUSTID_API_SECRET", "").strip()

ACOUSTID_API_KEY = os.getenv("ACOUSTID_API_KEY", "").strip()
ACOUSTID_URL = os.getenv("ACOUSTID_URL", "https://api.acoustid.org/v2/lookup").strip()

FPCALC_BIN = os.getenv("FPCALC_BIN", "fpcalc").strip()
FINGERPRINT_SECONDS = _int("FINGERPRINT_SECONDS", 120)
MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 20)
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

# AcoustID asks for at most ~3 lookups a second per application key.
MIN_REQUEST_INTERVAL_SEC = _float("MIN_REQUEST_INTERVAL_SEC", 0.34)
HTTP_TIMEOUT_SEC = _int("HTTP_TIMEOUT_SEC", 20)

# Accept a match only at this confidence (AcoustID scores are 0..1).
# 0.99 rejects almost every real YouTube/rip match; 0.85 is still strict.
MATCH_MIN_SCORE = _float("MATCH_MIN_SCORE", 0.85)
# When the upload title/filename is present, reject AcoustID rows that barely
# overlap it (same fingerprint often maps to unrelated same-score tracks).
MATCH_MIN_HINT_SCORE = _float("MATCH_MIN_HINT_SCORE", 0.25)

REDIS_ADDR = os.getenv("REDIS_ADDR", "localhost:6379").strip()
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "").strip() or None
REDIS_QUEUE = os.getenv("ACOUSTID_REDIS_QUEUE", "acoustid_jobs").strip() or "acoustid_jobs"
REDIS_CANCEL_PREFIX = "acoustid:cancel:"
REDIS_INFLIGHT_PREFIX = "acoustid:inflight:"
# Finished match payload (no SQL pending table — Redis is the buffer).
REDIS_RESULT_PREFIX = "acoustid:result:"
REDIS_RESULT_TTL_SEC = _int("ACOUSTID_RESULT_TTL_SEC", 24 * 3600)

APP_BASE_URL = os.getenv("APP_BASE_URL", "").strip().rstrip("/")
UPLOAD_WEBHOOK_SECRET = os.getenv("UPLOAD_WEBHOOK_SECRET", "").strip()
# GoUpload hosts cover art; prefer posting results here (compose: http://goupload:3003).
GOUPLOAD_INTERNAL_URL = os.getenv("GOUPLOAD_INTERNAL_URL", "http://127.0.0.1:3003").strip().rstrip("/")

CLIPS_DIR = os.getenv("ACOUSTID_CLIPS_DIR", "/tmp/acoustid_clips").strip()

ALLOWED_SUFFIXES = {
    ".mp3",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
    ".oga",
    ".opus",
    ".wav",
    ".wma",
    ".aiff",
    ".aif",
}


def missing_config() -> str | None:
    # AcoustID/.env only needs the application key (+ optional fpcalc tunables).
    # ACOUSTID_API_SECRET is injected by compose / GoUpload/.env in production;
    # local bare runs can omit it (binds to 127.0.0.1).
    if not ACOUSTID_API_KEY:
        return "ACOUSTID_API_KEY is not set (put it in AcoustID/.env)"
    return None
