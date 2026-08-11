"""MusicBrainz title/artist search when AcoustID fingerprint misses or disagrees.

Used for clear "Artist - Song" upload titles (e.g. Tiwa Savage - Eminado) where
the fingerprint DB returns the wrong track or nothing usable.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any
from urllib.parse import quote

import requests

import acoustid_client as ac
import config

log = logging.getLogger("acoustid")

_UA = "FileFree-AcoustID/1.0 (https://github.com; MusicBrainz title fallback)"
_HEADERS = {"User-Agent": _UA, "Accept": "application/json"}

_FEAT_SPLIT = re.compile(
    r"\s+(?:ft\.?|feat\.?|featuring|with)\s+",
    re.IGNORECASE,
)
_DASH_SPLIT = re.compile(r"\s+[-–—]\s+")
_PAREN_TAIL = re.compile(r"\s*[\(\[][^)\]]*[\)\]]\s*$")

_last_mb_call = 0.0


def _throttle_mb() -> None:
    """MusicBrainz asks for ≤1 req/sec."""
    global _last_mb_call
    wait = 1.05 - (time.monotonic() - _last_mb_call)
    if wait > 0:
        time.sleep(wait)
    _last_mb_call = time.monotonic()


def parse_title_hint(hint: str) -> tuple[str, str] | None:
    """Return (artist, title) from upload names like 'Artist - Song (Official Video)'."""
    raw = (hint or "").strip()
    if not raw:
        return None
    # URL-encoded junk titles are useless.
    if "%" in raw and any(x in raw.lower() for x in ("%20", "%23")):
        return None
    parts = _DASH_SPLIT.split(raw, maxsplit=1)
    if len(parts) != 2:
        return None
    artist_raw, title_raw = parts[0].strip(), parts[1].strip()
    if not artist_raw or not title_raw:
        return None
    # Primary artist only for search (drop ft. guests from the left side).
    artist = _FEAT_SPLIT.split(artist_raw, maxsplit=1)[0].strip()
    title = title_raw
    for _ in range(4):
        nxt = _PAREN_TAIL.sub("", title).strip()
        if nxt == title:
            break
        title = nxt
    # Guests often sit on the title side: "TATTOO Remix Ft Davido".
    title = _FEAT_SPLIT.split(title, maxsplit=1)[0].strip()
    # Drop video/lyric noise but keep the core song name (strip remix last).
    title = ac._HINT_NOISE.sub(" ", title)
    title = re.sub(r"\bremix\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+", " ", title).strip(" -_|")
    if len(artist) < 2 or len(title) < 2:
        return None
    # Need a bit of signal so meme filenames don't invent songs.
    if len(ac._token_set(artist)) < 1 or len(ac._token_set(title)) < 1:
        return None
    return artist, title


def _mb_get(url: str) -> dict[str, Any] | None:
    _throttle_mb()
    try:
        resp = requests.get(url, headers=_HEADERS, timeout=config.HTTP_TIMEOUT_SEC)
    except requests.RequestException as exc:
        log.warning("musicbrainz request failed: %s", exc)
        return None
    if resp.status_code != 200:
        log.warning("musicbrainz HTTP %s", resp.status_code)
        return None
    try:
        data = resp.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _artists_from_credit(credit: list[dict[str, Any]] | None) -> str:
    names: list[str] = []
    for part in credit or []:
        if not isinstance(part, dict):
            continue
        name = (part.get("name") or "").strip()
        if not name and isinstance(part.get("artist"), dict):
            name = str(part["artist"].get("name") or "").strip()
        if name:
            names.append(name)
    return ", ".join(names) if names else "Unknown artist"


def search_recording_by_title(
    title_hint: str,
    *,
    min_hint: float | None = None,
) -> dict[str, Any] | None:
    """Search MusicBrainz using a parsed upload title; return AcoustID-shaped match."""
    parsed = parse_title_hint(title_hint)
    if not parsed:
        return None
    artist, title = parsed
    floor = (
        float(min_hint)
        if min_hint is not None
        else max(0.45, float(config.MATCH_MIN_HINT_SCORE))
    )

    q = f'recording:"{title}" AND artist:"{artist}"'
    url = (
        "https://musicbrainz.org/ws/2/recording"
        f"?query={quote(q)}&fmt=json&limit=8"
    )
    data = _mb_get(url)
    if not data:
        return None

    candidates: list[dict[str, Any]] = []
    for rec in data.get("recordings") or []:
        if not isinstance(rec, dict) or not rec.get("id"):
            continue
        rec_title = str(rec.get("title") or "").strip() or "Unknown title"
        artists = _artists_from_credit(rec.get("artist-credit"))
        hs = ac.hint_overlap_score(title_hint, rec_title, artists)
        # Also score against the cleaned parse (stronger for Official Video noise).
        hs = max(hs, ac.hint_overlap_score(f"{artist} - {title}", rec_title, artists))
        mb_score = float(rec.get("score") or 0) / 100.0
        length_ms = rec.get("length")
        duration = None
        if isinstance(length_ms, (int, float)) and length_ms > 0:
            duration = float(length_ms) / 1000.0
        release_ids: list[str] = []
        rg_ids: list[str] = []
        album = None
        for rel in rec.get("releases") or []:
            if not isinstance(rel, dict):
                continue
            if rel.get("id"):
                release_ids.append(str(rel["id"]))
            if not album and rel.get("title"):
                album = str(rel["title"])
            rg = rel.get("release-group")
            if isinstance(rg, dict) and rg.get("id"):
                rg_ids.append(str(rg["id"]))
                if not album and rg.get("title"):
                    album = str(rg["title"])
        candidates.append(
            {
                "score": round(max(mb_score, 0.9), 4),  # title search — treat as strong
                "acoustid": None,
                "recording_mbid": rec.get("id"),
                "title": rec_title,
                "artists": artists,
                "duration": duration,
                "album": album,
                "release_group_mbid": rg_ids[0] if rg_ids else None,
                "release_group_mbids": rg_ids,
                "release_mbids": release_ids,
                "hint_score": round(hs, 4),
                "match_source": "musicbrainz_title",
                "musicbrainz_url": f"https://musicbrainz.org/recording/{rec['id']}",
            }
        )

    if not candidates:
        log.info("title fallback: no MB hits artist=%r title=%r", artist, title)
        return None

    candidates.sort(
        key=lambda r: (
            float(r.get("hint_score") or 0),
            float(r.get("score") or 0),
            1 if r.get("release_group_mbid") else 0,
            len(r.get("release_mbids") or []),
        ),
        reverse=True,
    )
    top = candidates[0]
    if float(top.get("hint_score") or 0) < floor:
        log.info(
            "title fallback: weak overlap artist=%r title=%r best=%r/%r hint=%.2f",
            artist,
            title,
            top.get("title"),
            top.get("artists"),
            float(top.get("hint_score") or 0),
        )
        return None

    # Enrich with release-groups for cover art when search omitted them.
    if not top.get("release_group_mbid") and top.get("recording_mbid"):
        detail = _mb_get(
            "https://musicbrainz.org/ws/2/recording/"
            f"{top['recording_mbid']}?inc=artists+releases+release-groups&fmt=json"
        )
        if detail:
            rg_ids: list[str] = []
            release_ids: list[str] = list(top.get("release_mbids") or [])
            album = top.get("album")
            for rel in detail.get("releases") or []:
                if not isinstance(rel, dict):
                    continue
                if rel.get("id") and str(rel["id"]) not in release_ids:
                    release_ids.append(str(rel["id"]))
                rg = rel.get("release-group")
                if isinstance(rg, dict) and rg.get("id"):
                    rid = str(rg["id"])
                    if rid not in rg_ids:
                        rg_ids.append(rid)
                    if not album and rg.get("title"):
                        album = str(rg["title"])
            if rg_ids:
                top["release_group_mbid"] = rg_ids[0]
                top["release_group_mbids"] = rg_ids
            if release_ids:
                top["release_mbids"] = release_ids
            if album:
                top["album"] = album

    log.info(
        "title fallback ok title=%r artists=%r hint=%.2f",
        top.get("title"),
        top.get("artists"),
        float(top.get("hint_score") or 0),
    )
    return top
