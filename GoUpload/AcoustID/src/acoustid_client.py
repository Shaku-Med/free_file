"""Fingerprint a local clip with Chromaprint, then ask AcoustID what it is."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import requests

import config

_rate_lock = threading.Lock()
_last_call = 0.0


class FingerprintError(RuntimeError):
    pass


class LookupError_(RuntimeError):
    pass


def fpcalc_available() -> bool:
    return shutil.which(config.FPCALC_BIN) is not None


def fingerprint(path: Path) -> tuple[int, str]:
    if not fpcalc_available():
        raise FingerprintError(
            f"'{config.FPCALC_BIN}' not found. Install Chromaprint in the image."
        )
    try:
        proc = subprocess.run(
            [
                config.FPCALC_BIN,
                "-json",
                "-length",
                str(config.FINGERPRINT_SECONDS),
                str(path),
            ],
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
    except (ValueError, KeyError, TypeError) as exc:
        raise FingerprintError("could not read fpcalc output") from exc


def _throttle() -> None:
    global _last_call
    with _rate_lock:
        wait = config.MIN_REQUEST_INTERVAL_SEC - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()


def lookup(duration: int, fp: str) -> dict[str, Any]:
    """duration should be the WHOLE source track length (AcoustID's requirement),
    not the short clip we fingerprinted."""
    _throttle()
    try:
        resp = requests.post(
            config.ACOUSTID_URL,
            data={
                "client": config.ACOUSTID_API_KEY,
                "duration": max(1, int(duration)),
                "fingerprint": fp,
                "meta": "recordings releasegroups releases compress",
            },
            timeout=config.HTTP_TIMEOUT_SEC,
        )
    except requests.RequestException as exc:
        raise LookupError_(f"could not reach AcoustID: {exc}") from exc

    if resp.status_code != 200:
        detail = ""
        try:
            detail = resp.json().get("error", {}).get("message", "")
        except Exception:
            detail = (resp.text or "")[:200]
        msg = f"AcoustID returned HTTP {resp.status_code}"
        if detail:
            msg = f"{msg}: {detail}"
        raise LookupError_(msg)

    body = resp.json()
    if body.get("status") != "ok":
        raise LookupError_(
            body.get("error", {}).get("message", "AcoustID rejected the request")
        )
    return body


_BAD_ARTIST_TOKENS = (
    "unknown artist",
    "second version",
    "karaoke",
    "tribute",
    "instrumental",
)

# Filename / upload-title noise — strip before comparing to AcoustID titles.
_HINT_NOISE = re.compile(
    r"\b("
    r"official(\s+music)?\s+video|music\s+video|lyric(s)?(\s+video)?|"
    r"audio|visuali[sz]er|hd|4k|mv|ft\.?|feat\.?|youtube|vevo|"
    r"remix|cover|live|instrumental|karaoke"
    r")\b",
    re.IGNORECASE,
)
_NON_WORD = re.compile(r"[^\w\s]+", re.UNICODE)


def _artist_quality(artists: str) -> int:
    a = (artists or "").strip().lower()
    if not a or a in _BAD_ARTIST_TOKENS:
        return 0
    if any(tok in a for tok in _BAD_ARTIST_TOKENS):
        return 1
    return 3


def _norm_hint_text(value: str) -> str:
    s = _HINT_NOISE.sub(" ", value or "")
    s = _NON_WORD.sub(" ", s)
    return " ".join(s.lower().split())


def _token_set(value: str) -> set[str]:
    return {t for t in _norm_hint_text(value).split() if len(t) >= 2}


def hint_overlap_score(hint: str | None, title: str, artists: str) -> float:
    """0..1 — how well an AcoustID row matches the upload title/filename.

    Same AcoustID fingerprint score often maps to several MusicBrainz
    recordings (cover / same-name tracks). Prefer the one that agrees with
    the video title when we have one.
    """
    hint_tokens = _token_set(hint or "")
    if not hint_tokens:
        return 0.0
    title_tokens = _token_set(title)
    artist_tokens = _token_set(artists)
    if not title_tokens and not artist_tokens:
        return 0.0
    title_hit = len(hint_tokens & title_tokens) / max(1, len(title_tokens))
    artist_hit = len(hint_tokens & artist_tokens) / max(1, len(artist_tokens)) if artist_tokens else 0.0
    # Title matters more; artist tokens in the filename (e.g. "Benson Boone - …")
    # break ties between same-named songs.
    return min(1.0, 0.7 * title_hit + 0.3 * artist_hit)


def shape_results(
    body: dict[str, Any],
    limit: int = 5,
    *,
    title_hint: str | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for result in body.get("results", []) or []:
        score = float(result.get("score") or 0)
        for rec in result.get("recordings", []) or []:
            groups = rec.get("releasegroups", []) or []
            # Prefer a release-group that looks like a proper album/single
            # (has a title) over empty stubs — helps cover-art fetch.
            first = next((g for g in groups if g.get("id") and g.get("title")), None)
            if first is None:
                first = groups[0] if groups else {}
            rg_ids = [str(g.get("id")) for g in groups if g.get("id")]
            releases = rec.get("releases", []) or []
            release_ids = [str(r.get("id")) for r in releases if r.get("id")]
            artists = ", ".join(
                a.get("name", "")
                for a in (rec.get("artists") or [])
                if a.get("name")
            ) or "Unknown artist"
            title = rec.get("title") or "Unknown title"
            out.append(
                {
                    "score": round(score, 4),
                    "acoustid": result.get("id"),
                    "recording_mbid": rec.get("id"),
                    "title": title,
                    "artists": artists,
                    "duration": rec.get("duration"),
                    "album": first.get("title"),
                    "release_group_mbid": first.get("id"),
                    # Extra IDs so webhook can try CAA on more than the first group.
                    "release_group_mbids": rg_ids,
                    "release_mbids": release_ids,
                    "hint_score": round(
                        hint_overlap_score(title_hint, title, artists), 4
                    ),
                    "musicbrainz_url": (
                        f"https://musicbrainz.org/recording/{rec['id']}"
                        if rec.get("id")
                        else None
                    ),
                }
            )
        # Fingerprint-only hits with no MusicBrainz recording are useless to us
        # (no title / artists / cover). Skip — do not invent stub rows.

    # AcoustID score first, then upload-title overlap, then richer metadata.
    out.sort(
        key=lambda r: (
            float(r.get("score") or 0),
            float(r.get("hint_score") or 0),
            _artist_quality(str(r.get("artists") or "")),
            1 if r.get("release_group_mbid") else 0,
            1 if r.get("album") else 0,
            len(r.get("release_mbids") or []),
        ),
        reverse=True,
    )
    return out[:limit]


def best_match(
    matches: list[dict[str, Any]],
    *,
    title_hint: str | None = None,
) -> dict[str, Any] | None:
    """Best match at or above MATCH_MIN_SCORE (metadata-aware sort already applied).

    Prefer rows with a MusicBrainz recording + real artist. When several rows
    share ~the same AcoustID score, prefer the one that matches the upload
    title/filename (Benson Boone vs a same-named cover).
    """
    eligible = [m for m in matches if float(m.get("score") or 0) >= config.MATCH_MIN_SCORE]
    if not eligible:
        return None

    # Recompute hint scores if caller passed a hint after shape_results.
    if title_hint:
        for m in eligible:
            m["hint_score"] = round(
                hint_overlap_score(
                    title_hint, str(m.get("title") or ""), str(m.get("artists") or "")
                ),
                4,
            )

    def _rank(r: dict[str, Any]) -> tuple:
        has_rec = 1 if r.get("recording_mbid") else 0
        return (
            has_rec,
            float(r.get("hint_score") or 0),
            _artist_quality(str(r.get("artists") or "")),
            1 if r.get("release_group_mbid") else 0,
            1 if r.get("album") else 0,
            len(r.get("release_mbids") or []),
            float(r.get("score") or 0),
        )

    eligible.sort(key=_rank, reverse=True)
    top = eligible[0]
    # Don't ship a useless stub to the app when that's all we got — better to
    # show nothing than "Unknown artist / no cover".
    if not top.get("recording_mbid") or _artist_quality(str(top.get("artists") or "")) == 0:
        return None
    # Title/filename disagrees hard with the AcoustID pick → treat as no match
    # (e.g. "Eminado" fingerprinted as another Tiwa Savage track).
    if title_hint and len(_token_set(title_hint)) >= 2:
        if float(top.get("hint_score") or 0) < float(config.MATCH_MIN_HINT_SCORE):
            return None
    return top
