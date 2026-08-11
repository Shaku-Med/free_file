"""Single-threaded Redis consumer: one AcoustID lookup at a time."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

import redis

import acoustid_client as ac
import config
import title_fallback
import webhook

log = logging.getLogger("acoustid")

_stop = threading.Event()
_rdb: redis.Redis | None = None


def redis_client() -> redis.Redis:
    global _rdb
    if _rdb is None:
        host, _, port_s = config.REDIS_ADDR.partition(":")
        port = int(port_s or "6379")
        _rdb = redis.Redis(
            host=host or "redis",
            port=port,
            password=config.REDIS_PASSWORD,
            decode_responses=True,
        )
    return _rdb


def enqueue(job: dict[str, Any]) -> None:
    redis_client().rpush(config.REDIS_QUEUE, json.dumps(job))


def _clear_result(upload_id: str) -> None:
    if upload_id:
        redis_client().delete(config.REDIS_RESULT_PREFIX + upload_id)


def store_result(upload_id: str, payload: dict[str, Any]) -> None:
    """Keep the finished match in Redis (replaces any SQL pending table)."""
    if not upload_id:
        return
    redis_client().setex(
        config.REDIS_RESULT_PREFIX + upload_id,
        config.REDIS_RESULT_TTL_SEC,
        json.dumps(payload),
    )


def request_cancel(job_id: str) -> None:
    if not job_id:
        return
    rdb = redis_client()
    # Marker so the in-flight worker aborts before webhooking.
    rdb.setex(config.REDIS_CANCEL_PREFIX + job_id, 3600, "1")
    # Drop result for an in-flight job (value is upload_id).
    inflight_upload = rdb.get(config.REDIS_INFLIGHT_PREFIX + job_id)
    if inflight_upload:
        _clear_result(str(inflight_upload))
    # Drop any still-queued copies of this job.
    raw_items = rdb.lrange(config.REDIS_QUEUE, 0, -1) or []
    kept: list[str] = []
    removed = 0
    for raw in raw_items:
        try:
            job = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            kept.append(raw)
            continue
        if job.get("job_id") == job_id:
            removed += 1
            clip = job.get("clip_path") or ""
            if clip:
                _unlink(clip)
            _clear_result(str(job.get("upload_id") or ""))
            continue
        kept.append(raw)
    if removed:
        pipe = rdb.pipeline()
        pipe.delete(config.REDIS_QUEUE)
        if kept:
            pipe.rpush(config.REDIS_QUEUE, *kept)
        pipe.execute()
    log.info("cancel job_id=%s removed_queued=%d", job_id, removed)


def is_cancelled(job_id: str) -> bool:
    if not job_id:
        return False
    return bool(redis_client().exists(config.REDIS_CANCEL_PREFIX + job_id))


def clear_cancel(job_id: str) -> None:
    if job_id:
        redis_client().delete(config.REDIS_CANCEL_PREFIX + job_id)


def _unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


def _process(job: dict[str, Any]) -> None:
    job_id = str(job.get("job_id") or "")
    upload_id = str(job.get("upload_id") or "")
    clip_path = str(job.get("clip_path") or "")
    rdb = redis_client()

    if is_cancelled(job_id):
        log.info("skip cancelled job_id=%s upload=%s", job_id, upload_id)
        _unlink(clip_path)
        clear_cancel(job_id)
        return

    if not clip_path or not os.path.isfile(clip_path):
        log.warning("missing clip job_id=%s path=%r", job_id, clip_path)
        return

    rdb.setex(config.REDIS_INFLIGHT_PREFIX + job_id, 600, upload_id)
    try:
        if is_cancelled(job_id):
            log.info("cancelled before fingerprint job_id=%s", job_id)
            return

        try:
            clip_duration, fp = ac.fingerprint(Path(clip_path))
        except ac.FingerprintError as exc:
            log.warning("fingerprint failed job_id=%s: %s", job_id, exc)
            webhook.notify_result(
                {
                    "job_id": job_id,
                    "upload_id": upload_id,
                    "unique_id": job.get("unique_id") or upload_id,
                    "matched": False,
                    "error": str(exc),
                    "clip_start": job.get("clip_start"),
                    "clip_end": job.get("clip_end"),
                }
            )
            return

        if is_cancelled(job_id):
            log.info("cancelled before lookup job_id=%s", job_id)
            return

        # AcoustID wants the whole-track duration for single-song rips.
        # Long mixes / lyric compilations (10+ min) poison the lookup when we
        # only fingerprinted the first ~2 min of one song — retry with the
        # fingerprint duration when the long-file lookup returns nothing.
        source_duration = int(job.get("source_duration") or 0)
        lookup_duration = source_duration if source_duration > 0 else clip_duration

        try:
            body = ac.lookup(lookup_duration, fp)
        except ac.LookupError_ as exc:
            log.warning("lookup failed job_id=%s: %s", job_id, exc)
            webhook.notify_result(
                {
                    "job_id": job_id,
                    "upload_id": upload_id,
                    "unique_id": job.get("unique_id") or upload_id,
                    "matched": False,
                    "error": str(exc),
                    "clip_start": job.get("clip_start"),
                    "clip_end": job.get("clip_end"),
                }
            )
            return

        if is_cancelled(job_id):
            log.info("cancelled after lookup job_id=%s", job_id)
            return

        title_hint = str(job.get("title_hint") or "").strip() or None
        matches = ac.shape_results(body, title_hint=title_hint)
        best = ac.best_match(matches, title_hint=title_hint)
        # Long mixes / lyric compilations: whole-file duration often blocks a
        # hit. Retry with the fingerprinted length, then a few typical song
        # lengths AcoustID catalogs use.
        if best is None and clip_duration > 0:
            retry_durs: list[int] = []
            if source_duration > max(180, clip_duration + 30):
                retry_durs.append(clip_duration)
            for d in (240, 270, 285, 300, 210, 180):
                if d not in retry_durs and d != lookup_duration:
                    retry_durs.append(d)
            for alt in retry_durs:
                if is_cancelled(job_id):
                    break
                log.info(
                    "retry lookup job_id=%s duration=%ds (source=%ds)",
                    job_id,
                    alt,
                    source_duration,
                )
                try:
                    body2 = ac.lookup(alt, fp)
                except ac.LookupError_ as exc:
                    log.warning("retry lookup failed job_id=%s dur=%d: %s", job_id, alt, exc)
                    continue
                matches2 = ac.shape_results(body2, title_hint=title_hint)
                best2 = ac.best_match(matches2, title_hint=title_hint)
                if best2 is not None:
                    body, matches, best = body2, matches2, best2
                    break
                if matches2 and not matches:
                    body, matches = body2, matches2
        # Fingerprint missed / disagreed with the upload title — try MusicBrainz
        # by parsing "Artist - Song" from the filename (Eminado, etc.).
        if best is None and title_hint:
            mb = title_fallback.search_recording_by_title(title_hint)
            if mb is not None:
                best = mb
                matches = [mb] + list(matches or [])

        if best:
            best = dict(best)
            log.info(
                "match job_id=%s upload=%s score=%.4f hint=%.2f title=%r artists=%r source=%s",
                job_id,
                upload_id,
                float(best.get("score") or 0),
                float(best.get("hint_score") or 0),
                best.get("title"),
                best.get("artists"),
                best.get("match_source") or "acoustid",
            )
        elif matches:
            top = matches[0]
            log.info(
                "below threshold job_id=%s upload=%s best_score=%.4f min=%.2f title=%r count=%d",
                job_id,
                upload_id,
                float(top.get("score") or 0),
                config.MATCH_MIN_SCORE,
                top.get("title"),
                len(matches),
            )
        else:
            log.info("no acoustid results job_id=%s upload=%s", job_id, upload_id)

        result_payload = {
            "job_id": job_id,
            "upload_id": upload_id,
            "unique_id": job.get("unique_id") or upload_id,
            "user_id": job.get("user_id") or "",
            "storage_prefix": job.get("storage_prefix") or "",
            "matched": best is not None,
            "match": best,
            "match_count": len(matches),
            "clip_start": job.get("clip_start"),
            "clip_end": job.get("clip_end"),
            "fingerprinted_seconds": min(clip_duration, config.FINGERPRINT_SECONDS),
            "source_duration": lookup_duration,
            "min_score": config.MATCH_MIN_SCORE,
        }
        # Redis is the only staging area (queue + result). No SQL pending table.
        store_result(upload_id, result_payload)
        if is_cancelled(job_id):
            log.info("cancelled before webhook job_id=%s", job_id)
            _clear_result(upload_id)
            return
        webhook.notify_result(result_payload)
    finally:
        rdb.delete(config.REDIS_INFLIGHT_PREFIX + job_id)
        clear_cancel(job_id)
        _unlink(clip_path)


def run_forever() -> None:
    log.info(
        "worker ready queue=%s interval=%.2fs min_score=%.2f",
        config.REDIS_QUEUE,
        config.MIN_REQUEST_INTERVAL_SEC,
        config.MATCH_MIN_SCORE,
    )
    rdb = redis_client()
    while not _stop.is_set():
        try:
            item = rdb.blpop(config.REDIS_QUEUE, timeout=2)
        except redis.RedisError as exc:
            log.warning("redis blpop error: %s", exc)
            time.sleep(1)
            continue
        if not item:
            continue
        _, raw = item
        try:
            job = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            log.warning("bad job payload: %r", (raw or "")[:200])
            continue
        try:
            _process(job)
        except Exception as exc:  # noqa: BLE001 — keep the loop alive
            log.exception("job crashed: %s", exc)


def start_background() -> threading.Thread:
    t = threading.Thread(target=run_forever, name="acoustid-worker", daemon=True)
    t.start()
    return t


def stop() -> None:
    _stop.set()
