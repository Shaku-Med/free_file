"""Music/speech analysis (inaSpeechSegmenter) and the is_music decision.

The model import is lazy so the pure aggregation/decision helpers below can be
imported and unit-tested without TensorFlow present. When the ML stack is absent
(local dev without docker) the service falls back to a stub so `python main.py`
still runs; production turns the stub off via MUSIC_ALLOW_STUB=0 so a broken image
fails loudly instead of silently faking results.
"""

from __future__ import annotations

import logging
import os
import threading

log = logging.getLogger("musicdetector")

MUSIC_LABEL = "music"
SPEECH_LABEL = "speech"
# Frames with no usable energy (silence). Excluded from the ratio denominator so
# leading/trailing silence can't make a real song look "less musical".
SILENCE_LABELS = frozenset({"noEnergy", "noise", "silence"})

_lock = threading.Lock()
_segmenter = None
_stub_mode = False


def summarize_segments(segments) -> dict:
    totals: dict[str, float] = {}
    for seg in segments:
        label, start, stop = seg[0], float(seg[1]), float(seg[2])
        dur = stop - start
        if dur > 0:
            totals[label] = totals.get(label, 0.0) + dur

    music = totals.get(MUSIC_LABEL, 0.0)
    speech = totals.get(SPEECH_LABEL, 0.0)
    voiced = sum(d for lbl, d in totals.items() if lbl not in SILENCE_LABELS)
    analyzed = sum(totals.values())
    ratio = music / voiced if voiced > 0 else 0.0

    return {
        "music_seconds": round(music, 2),
        "speech_seconds": round(speech, 2),
        "voiced_seconds": round(voiced, 2),
        "analyzed_seconds": round(analyzed, 2),
        "music_ratio": round(ratio, 4),
    }


def decide_is_music(summary: dict, ratio_threshold: float, min_music_seconds: float) -> bool:
    return (
        summary["music_ratio"] >= ratio_threshold
        and summary["music_seconds"] >= min_music_seconds
    )


def is_stub() -> bool:
    return _stub_mode


def _stub_allowed() -> bool:
    return os.environ.get("MUSIC_ALLOW_STUB", "1").strip().lower() not in ("0", "false", "no", "off", "")


def warmup() -> None:
    """Load the model once (startup + image build). Falls back to the dev stub when
    the ML stack is missing, unless MUSIC_ALLOW_STUB=0 (set in production)."""
    global _stub_mode
    try:
        _load_segmenter()
        _stub_mode = False
        log.info("inaSpeechSegmenter model loaded")
    except RuntimeError:
        if not _stub_allowed():
            raise
        _stub_mode = True
        log.warning(
            "inaSpeechSegmenter not installed -> DEV STUB mode: is_music results are "
            "FAKE. Run the docker image for real detection (or set MUSIC_ALLOW_STUB=0 "
            "to fail instead of stubbing)."
        )


def _load_segmenter():
    global _segmenter
    if _segmenter is None:
        try:
            from inaSpeechSegmenter import Segmenter
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "inaSpeechSegmenter is not installed (ML stack is docker-only, "
                "Python 3.11)."
            ) from exc
        _segmenter = Segmenter(detect_gender=False)
    return _segmenter


def _stub_segments(path: str):
    # Deterministic fake segmentation from file size so dev runs are stable and can
    # hit both is_music branches with no model: even size -> mostly music.
    total = 120.0
    music = total * 0.9 if os.path.getsize(path) % 2 == 0 else total * 0.1
    return [("music", 0.0, music), ("speech", music, total)]


def analyze_file(path: str, stop_sec: float | None = None) -> dict:
    if _stub_mode:
        return summarize_segments(_stub_segments(path))
    seg = _load_segmenter()
    # The Keras model is not safe to run from multiple threads at once; the service
    # also caps concurrency, but serialize here as a hard guarantee.
    with _lock:
        segments = seg(path, start_sec=0, stop_sec=stop_sec)
    return summarize_segments(segments)
