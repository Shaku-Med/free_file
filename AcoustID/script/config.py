"""Configuration, read from the environment only.

The API key never appears in source and never reaches the browser. The whole
folder is gitignored, but that is a second line of defence, not the first.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


ACOUSTID_API_KEY = os.getenv("ACOUSTID_API_KEY", "").strip()
ACOUSTID_URL = os.getenv("ACOUSTID_URL", "https://api.acoustid.org/v2/lookup").strip()

# Chromaprint's CLI. Ships with the Chromaprint release, not with the pip
# package, so it is configurable for people who did not put it on PATH.
FPCALC_BIN = os.getenv("FPCALC_BIN", "fpcalc").strip()

# AcoustID's own guidance: fingerprint the first two minutes. Longer does not
# improve matching and only slows the request. The service never sees the audio,
# only this fingerprint.
FINGERPRINT_SECONDS = _int("FINGERPRINT_SECONDS", 120)

# Our own upload ceiling. AcoustID has no file limit because no file is sent to
# it; this exists so a stray 2GB drop cannot fill the disk.
MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 60)
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

# AcoustID asks for no more than 3 lookups a second per key.
MIN_REQUEST_INTERVAL_SEC = float(os.getenv("MIN_REQUEST_INTERVAL_SEC", "0.34"))

HTTP_TIMEOUT_SEC = _int("HTTP_TIMEOUT_SEC", 20)

UPLOAD_DIR = ROOT / "uploads"
PUBLIC_DIR = ROOT / "public"

# Audio only. Checked against the sniffed type as well as the extension.
ALLOWED_SUFFIXES = {
    ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga",
    ".opus", ".wav", ".wma", ".aiff", ".aif", ".mp4",
}


def missing_config() -> str | None:
    """Returns why the service cannot run, or None when it can."""
    if not ACOUSTID_API_KEY:
        return "ACOUSTID_API_KEY is not set. Copy .env.example to .env and add your key."
    return None
