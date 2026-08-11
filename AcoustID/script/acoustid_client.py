"""Fingerprint a file with Chromaprint, then ask AcoustID what it is.

Worth being clear about the split, because it surprises people:

  * AcoustID identifies a RECORDING and hands back MusicBrainz ids. It has no
    artwork of its own.
  * Cover art comes from the Cover Art Archive, looked up separately by the
    release-group id AcoustID gave us.

So a match with no artwork is normal, not a failure: plenty of MusicBrainz
release groups have no cover uploaded.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import requests

import config

COVER_ART_URL = "https://coverartarchive.org/release-group/{mbid}/front-250"

_rate_lock = threading.Lock()
_last_call = 0.0


class FingerprintError(RuntimeError):
    pass


class LookupError_(RuntimeError):
    pass


def fpcalc_available() -> bool:
    return shutil.which(config.FPCALC_BIN) is not None


def fingerprint(path: Path) -> tuple[int, str]:
    """Returns (duration_seconds, fingerprint) for the first N seconds."""
    if not fpcalc_available():
        raise FingerprintError(
            f"'{config.FPCALC_BIN}' not found. Install Chromaprint and put fpcalc on PATH, "
            "or set FPCALC_BIN in .env to its full path."
        )
    try:
        # Argument list, never a shell string: the filename comes from an upload
        # and must never be parsed by a shell.
        proc = subprocess.run(
            [config.FPCALC_BIN, "-json", "-length", str(config.FINGERPRINT_SECONDS), str(path)],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise FingerprintError("fpcalc timed out") from exc

    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()
        raise FingerprintError(detail[-1] if detail else "fpcalc failed")

    try:
        parsed = json.loads(proc.stdout)
        return int(round(float(parsed["duration"]))), str(parsed["fingerprint"])
    except (ValueError, KeyError) as exc:
        raise FingerprintError("could not read fpcalc output") from exc


def _throttle() -> None:
    """AcoustID asks for at most ~3 lookups a second per key."""
    global _last_call
    with _rate_lock:
        wait = config.MIN_REQUEST_INTERVAL_SEC - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()


def lookup(duration: int, fp: str) -> dict[str, Any]:
    _throttle()
    try:
        resp = requests.post(
            config.ACOUSTID_URL,
            data={
                "client": config.ACOUSTID_API_KEY,
                "duration": duration,
                "fingerprint": fp,
                # compress keeps the response small; the rest is what we render.
                "meta": "recordings releasegroups compress",
            },
            timeout=config.HTTP_TIMEOUT_SEC,
        )
    except requests.RequestException as exc:
        raise LookupError_(f"could not reach AcoustID: {exc}") from exc

    if resp.status_code != 200:
        raise LookupError_(f"AcoustID returned HTTP {resp.status_code}")

    body = resp.json()
    if body.get("status") != "ok":
        raise LookupError_(body.get("error", {}).get("message", "AcoustID rejected the request"))
    return body


def cover_art(release_group_mbid: str) -> str | None:
    """Front cover for a release group, or None when nothing is archived."""
    if not release_group_mbid:
        return None
    url = COVER_ART_URL.format(mbid=release_group_mbid)
    try:
        # HEAD is enough: we only need to know it resolves. The archive 307s to
        # the actual image host.
        resp = requests.head(url, timeout=config.HTTP_TIMEOUT_SEC, allow_redirects=True)
        return url if resp.status_code == 200 else None
    except requests.RequestException:
        return None


def shape_results(body: dict[str, Any], limit: int = 5) -> list[dict[str, Any]]:
    """Flattens AcoustID's nested response into rows the page can render."""
    out: list[dict[str, Any]] = []
    for result in body.get("results", []) or []:
        score = float(result.get("score") or 0)
        for rec in result.get("recordings", []) or []:
            groups = rec.get("releasegroups", []) or []
            first = groups[0] if groups else {}
            out.append(
                {
                    "score": round(score, 4),
                    "acoustid": result.get("id"),
                    "recording_mbid": rec.get("id"),
                    "title": rec.get("title") or "Unknown title",
                    "artists": ", ".join(
                        a.get("name", "") for a in (rec.get("artists") or []) if a.get("name")
                    )
                    or "Unknown artist",
                    "duration": rec.get("duration"),
                    "album": first.get("title"),
                    "release_group_mbid": first.get("id"),
                    "musicbrainz_url": (
                        f"https://musicbrainz.org/recording/{rec['id']}" if rec.get("id") else None
                    ),
                }
            )
        # A result can match with no recording metadata attached at all.
        if not (result.get("recordings") or []):
            out.append(
                {
                    "score": round(score, 4),
                    "acoustid": result.get("id"),
                    "recording_mbid": None,
                    "title": "Matched, but MusicBrainz has no metadata for it",
                    "artists": "Unknown artist",
                    "duration": None,
                    "album": None,
                    "release_group_mbid": None,
                    "musicbrainz_url": None,
                }
            )

    out.sort(key=lambda r: r["score"], reverse=True)
    return out[:limit]
