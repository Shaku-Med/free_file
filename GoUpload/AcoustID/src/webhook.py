"""Deliver AcoustID results through GoUpload so cover art is hosted locally.

Prefer GOUPLOAD_INTERNAL_URL (/internal/acoustid-result): GoUpload saves the
cover next to thumbnails, uploads it, and forwards a storage path to the app.
Falls back to posting JSON straight at the app when GoUpload is unreachable.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Iterable

import requests

import config

log = logging.getLogger("acoustid")

# MusicBrainz / CAA require a descriptive User-Agent; bare python-requests
# gets blocked or empty responses → cover=False even on good matches.
_UA = "FileFree-AcoustID/1.0 (https://github.com; cover-art fetch)"
_HEADERS = {"User-Agent": _UA, "Accept": "*/*"}

COVER_RG_URLS = (
    "https://coverartarchive.org/release-group/{mbid}/front-500",
    "https://coverartarchive.org/release-group/{mbid}/front-250",
    "https://coverartarchive.org/release-group/{mbid}/front",
)
COVER_RELEASE_URLS = (
    "https://coverartarchive.org/release/{mbid}/front-500",
    "https://coverartarchive.org/release/{mbid}/front-250",
    "https://coverartarchive.org/release/{mbid}/front",
)


# Cover Art Archive redirects to its storage host, so redirects must be allowed.
# That is also the risk: a redirect we follow could land on an internal address.
# Two things stop that becoming a disclosure. The body must begin with real JPEG
# or PNG magic bytes, so an internal endpoint that merely claims image/* in a
# header cannot have its response stored and then republished as a cover. And
# the read is capped, so a huge or endless response cannot take the sidecar down.
MAX_COVER_BYTES = 8 * 1024 * 1024
MAX_REDIRECTS = 5

# MusicBrainz ids are UUIDs. AcoustID is third party, so its ids get validated
# before being interpolated into a URL path rather than trusted.
_MBID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _looks_like_image(content: bytes) -> bool:
    """Magic bytes only. Content-Type is attacker-influenced through a redirect."""
    return content.startswith(b"\xff\xd8\xff") or content.startswith(b"\x89PNG")


def _fetch_cover_url(url: str) -> bytes | None:
    buf = bytearray()
    try:
        with requests.get(
            url,
            timeout=config.HTTP_TIMEOUT_SEC,
            allow_redirects=True,
            headers=_HEADERS,
            # Streamed so the cap applies while reading, instead of after a
            # whole response is already resident in memory.
            stream=True,
        ) as resp:
            if resp.status_code != 200:
                return None
            if len(resp.history) > MAX_REDIRECTS:
                log.warning("cover redirect chain too long url=%s", url)
                return None
            for chunk in resp.iter_content(64 * 1024):
                if not chunk:
                    continue
                buf.extend(chunk)
                if len(buf) > MAX_COVER_BYTES:
                    log.warning("cover exceeded %d bytes url=%s", MAX_COVER_BYTES, url)
                    return None
    except requests.RequestException as exc:
        log.warning("cover download failed url=%s: %s", url, exc)
        return None

    data = bytes(buf)
    return data if data and _looks_like_image(data) else None


def _try_mbids(mbids: Iterable[str], templates: tuple[str, ...], kind: str) -> bytes | None:
    seen: set[str] = set()
    for mbid in mbids:
        mbid = (mbid or "").strip()
        if not mbid or mbid in seen:
            continue
        if not _MBID_RE.match(mbid):
            log.warning("skipping non-uuid mbid kind=%s value=%r", kind, mbid[:64])
            continue
        seen.add(mbid)
        for tmpl in templates:
            data = _fetch_cover_url(tmpl.format(mbid=mbid))
            if data:
                log.info("cover ok kind=%s mbid=%s bytes=%d", kind, mbid, len(data))
                return data
        log.info("cover miss kind=%s mbid=%s", kind, mbid)
    return None


def download_cover(
    release_group_mbids: str | Iterable[str] | None = None,
    release_mbids: Iterable[str] | None = None,
) -> bytes | None:
    """Try Cover Art Archive: release-group first, then individual releases."""
    if isinstance(release_group_mbids, str):
        rg_list = [release_group_mbids]
    else:
        rg_list = list(release_group_mbids or [])
    data = _try_mbids(rg_list, COVER_RG_URLS, "release-group")
    if data:
        return data
    return _try_mbids(list(release_mbids or []), COVER_RELEASE_URLS, "release")


def notify_result(payload: dict[str, Any]) -> bool:
    match = payload.get("match") if isinstance(payload.get("match"), dict) else None
    cover_bytes: bytes | None = None
    if payload.get("matched") and match:
        # Prefer primary release_group_mbid, then any extras / release MBIDs.
        rg_mbids: list[str] = []
        primary = str(match.get("release_group_mbid") or "").strip()
        if primary:
            rg_mbids.append(primary)
        extra = match.get("release_group_mbids")
        if isinstance(extra, list):
            rg_mbids.extend(str(x) for x in extra if x)
        rel_extra = match.get("release_mbids")
        rel_mbids = [str(x) for x in rel_extra] if isinstance(rel_extra, list) else []
        cover_bytes = download_cover(rg_mbids, rel_mbids)
        if not cover_bytes:
            log.warning(
                "cover=False upload=%s title=%r rg=%s",
                payload.get("upload_id"),
                match.get("title"),
                primary or "(none)",
            )
        match.pop("cover_art", None)
        # Keep helper ID lists out of the app payload (storage path only).
        match.pop("release_group_mbids", None)
        match.pop("release_mbids", None)

    if config.GOUPLOAD_INTERNAL_URL:
        if _notify_goupload(payload, match, cover_bytes):
            return True
        log.warning("goupload notify failed; falling back to app webhook")

    return _notify_app(payload, match)


def _notify_goupload(
    payload: dict[str, Any],
    match: dict[str, Any] | None,
    cover_bytes: bytes | None,
) -> bool:
    url = config.GOUPLOAD_INTERNAL_URL.rstrip("/") + "/internal/acoustid-result"
    secret = config.UPLOAD_WEBHOOK_SECRET or config.SECRET
    if not secret:
        log.warning("goupload notify skipped: no webhook/internal secret")
        return False

    data = {
        "job_id": str(payload.get("job_id") or ""),
        "upload_id": str(payload.get("upload_id") or ""),
        "user_id": str(payload.get("user_id") or ""),
        "storage_prefix": str(payload.get("storage_prefix") or ""),
        "matched": "true" if payload.get("matched") else "false",
        "clip_start": str(payload.get("clip_start") or ""),
        "clip_end": str(payload.get("clip_end") or ""),
        "match_count": str(payload.get("match_count") or ""),
        "min_score": str(payload.get("min_score") or ""),
        "error": str(payload.get("error") or ""),
    }
    if match is not None:
        data["match"] = json.dumps(match)

    files = None
    if cover_bytes:
        files = {"cover": ("acoustid_cover.jpg", cover_bytes, "image/jpeg")}

    try:
        resp = requests.post(
            url,
            data=data,
            files=files,
            headers={"X-Webhook-Secret": secret},
            timeout=config.HTTP_TIMEOUT_SEC + 15,
        )
    except requests.RequestException as exc:
        log.warning("goupload transport failed upload=%s: %s", payload.get("upload_id"), exc)
        return False

    if 200 <= resp.status_code < 300:
        log.info(
            "goupload ok upload=%s http=%d matched=%s cover=%s",
            payload.get("upload_id"),
            resp.status_code,
            payload.get("matched"),
            bool(cover_bytes),
        )
        return True

    log.warning(
        "goupload http=%d upload=%s body=%r",
        resp.status_code,
        payload.get("upload_id"),
        (resp.text or "")[:300],
    )
    return False


def _notify_app(payload: dict[str, Any], match: dict[str, Any] | None) -> bool:
    if not config.APP_BASE_URL or not config.UPLOAD_WEBHOOK_SECRET:
        log.warning("app webhook skipped: APP_BASE_URL or UPLOAD_WEBHOOK_SECRET unset")
        return False

    body = dict(payload)
    if match is not None:
        # No external cover URL when bypassing GoUpload hosting.
        clean = dict(match)
        clean.pop("cover_art", None)
        clean.pop("release_group_mbids", None)
        body["match"] = clean

    url = config.APP_BASE_URL + "/api/acoustid-result"
    try:
        resp = requests.post(
            url,
            json=body,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Secret": config.UPLOAD_WEBHOOK_SECRET,
            },
            timeout=config.HTTP_TIMEOUT_SEC,
        )
    except requests.RequestException as exc:
        log.warning("app webhook transport failed upload=%s: %s", payload.get("upload_id"), exc)
        return False

    if 200 <= resp.status_code < 300:
        log.info(
            "app webhook ok upload=%s http=%d matched=%s",
            payload.get("upload_id"),
            resp.status_code,
            payload.get("matched"),
        )
        return True

    log.warning(
        "app webhook http=%d upload=%s body=%r",
        resp.status_code,
        payload.get("upload_id"),
        (resp.text or "")[:300],
    )
    return False
