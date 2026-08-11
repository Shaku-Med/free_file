"""Local AcoustID test bench.

    python script/app.py        then open http://127.0.0.1:8077

Upload an audio file, it gets fingerprinted with Chromaprint, the fingerprint
(never the audio) goes to AcoustID, and whatever MusicBrainz knows comes back
with cover art from the Cover Art Archive.

Local only. It binds to 127.0.0.1 and is not built to face the internet.
"""

from __future__ import annotations

import mimetypes
import shutil
import tempfile
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import acoustid_client as ac
import config

app = FastAPI(title="AcoustID test bench", docs_url=None, redoc_url=None)


def _err(message: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"ok": False, "error": message}, status_code=status)


@app.get("/api/health")
def health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "api_key_set": bool(config.ACOUSTID_API_KEY),
            "fpcalc_found": ac.fpcalc_available(),
            "max_upload_mb": config.MAX_UPLOAD_MB,
            "fingerprint_seconds": config.FINGERPRINT_SECONDS,
        }
    )


@app.post("/api/identify")
async def identify(file: UploadFile = File(...)) -> JSONResponse:
    problem = config.missing_config()
    if problem:
        return _err(problem, 503)
    if not ac.fpcalc_available():
        return _err(
            f"'{config.FPCALC_BIN}' not found. Install Chromaprint, or set FPCALC_BIN in .env.",
            503,
        )

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in config.ALLOWED_SUFFIXES:
        return _err(f"Unsupported file type '{suffix or 'unknown'}'.")

    guessed, _ = mimetypes.guess_type(file.filename or "")
    if guessed and not (guessed.startswith("audio/") or guessed in {"video/mp4"}):
        return _err("That does not look like an audio file.")

    # Stream to a temp file with a generated name. The uploaded filename is
    # never used as a path: it decides the suffix and nothing else.
    tmp_dir = Path(tempfile.gettempdir())
    tmp_path = tmp_dir / f"acoustid_{uuid.uuid4().hex}{suffix}"
    written = 0
    try:
        with tmp_path.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > config.MAX_UPLOAD_BYTES:
                    return _err(
                        f"File is larger than the {config.MAX_UPLOAD_MB}MB limit. "
                        f"Only the first {config.FINGERPRINT_SECONDS}s is fingerprinted anyway, "
                        "so a trimmed clip works just as well.",
                        413,
                    )
                out.write(chunk)

        if written == 0:
            return _err("Empty file.")

        try:
            duration, fp = ac.fingerprint(tmp_path)
        except ac.FingerprintError as exc:
            return _err(str(exc), 422)

        try:
            body = ac.lookup(duration, fp)
        except ac.LookupError_ as exc:
            return _err(str(exc), 502)

        matches = ac.shape_results(body)
        for m in matches:
            m["cover_art"] = ac.cover_art(m.get("release_group_mbid") or "")

        return JSONResponse(
            {
                "ok": True,
                "filename": file.filename,
                "duration": duration,
                "fingerprinted_seconds": min(duration, config.FINGERPRINT_SECONDS),
                "match_count": len(matches),
                "matches": matches,
            }
        )
    finally:
        tmp_path.unlink(missing_ok=True)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(config.PUBLIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(config.PUBLIC_DIR)), name="public")


if __name__ == "__main__":
    if problem := config.missing_config():
        print(f"[warn] {problem}")
    if not ac.fpcalc_available():
        print(f"[warn] '{config.FPCALC_BIN}' not found on PATH. Install Chromaprint first.")
    print("AcoustID test bench -> http://127.0.0.1:8077")
    uvicorn.run(app, host="127.0.0.1", port=8077, log_level="info")
