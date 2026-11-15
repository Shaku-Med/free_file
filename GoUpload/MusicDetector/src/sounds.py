"""Sound tags for auto captions ([Laughter], [Applause] ...) from YAMNet.

YAMNet scores AudioSet's 521 classes on 0.96 s windows every 0.48 s. Only a
few human and crowd sounds become tags, each with its own bar. Each frame goes
to its strongest tag only, and the tags a singer can set off (a shout, a
breath) are left out wherever YAMNet hears music.
"""

from __future__ import annotations

import logging
import subprocess
import threading

import numpy as np

log = logging.getLogger("musicdetector")

SAMPLE_RATE = 16000
HOP = 7680  # 0.48 s
WINDOW = 15360  # 0.96 s
HOP_SECONDS = HOP / SAMPLE_RATE
WINDOW_SECONDS = WINDOW / SAMPLE_RATE
# 60 s of frames per model call, so memory stays flat however long the audio.
CHUNK_FRAMES = 125
MUSIC_CLASS = 132
MUSIC_BAR = 0.3
MAX_EVENTS = 2000

# label: (AudioSet class ids, frame bar, peak bar, min frames, allowed over music)
TAGS: dict[str, tuple[tuple[int, ...], float, float, int, bool]] = {
    "Laughter": ((13, 14, 15, 16, 17, 18), 0.2, 0.4, 2, True),
    "Applause": ((58, 62), 0.3, 0.5, 2, True),
    "Cheering": ((8, 61), 0.3, 0.5, 2, True),
    "Shouting": ((6, 7, 9, 10), 0.35, 0.5, 1, False),
    "Screaming": ((11,), 0.3, 0.45, 1, False),
    "Crying": ((19, 20, 21, 22), 0.3, 0.5, 2, False),
    # Only heavy breathing: a breath between sentences is not worth a line.
    "Breathing": ((36, 40), 0.5, 0.7, 2, False),
    "Sighs": ((23,), 0.4, 0.5, 1, False),
    "Gasps": ((39,), 0.4, 0.5, 1, False),
    "Coughing": ((42, 43), 0.4, 0.6, 1, True),
    "Sneezing": ((44,), 0.4, 0.6, 1, True),
    "Whistling": ((35,), 0.4, 0.6, 2, False),
    "Dog barking": ((69, 70), 0.4, 0.6, 1, True),
}

_lock = threading.Lock()
_model = None


def detect(scores: np.ndarray) -> list[dict]:
    """Events {label, start, end} in seconds from YAMNet scores [frames, 521]."""
    if scores.ndim != 2 or scores.shape[0] == 0 or scores.shape[1] <= MUSIC_CLASS:
        return []
    music = scores[:, MUSIC_CLASS] >= MUSIC_BAR
    labels = list(TAGS)
    strength = np.zeros((scores.shape[0], len(labels)), dtype=np.float32)
    for k, label in enumerate(labels):
        ids, bar, _, _, over_music = TAGS[label]
        s = scores[:, ids].max(axis=1)
        on = s >= bar
        if not over_music:
            on &= ~music
        strength[:, k] = np.where(on, s, 0)
    winner = strength.argmax(axis=1)
    any_on = strength.max(axis=1) > 0

    events = []
    for k, label in enumerate(labels):
        _, _, peak, min_frames, _ = TAGS[label]
        idx = np.flatnonzero(any_on & (winner == k))
        if idx.size == 0:
            continue
        # One frame gaps are bridged: a laugh dips for a breath.
        for run in np.split(idx, np.flatnonzero(np.diff(idx) > 2) + 1):
            a, b = int(run[0]), int(run[-1])
            if b - a + 1 < min_frames or strength[a:b + 1, k].max() < peak:
                continue
            events.append({
                "label": label,
                "start": round(a * HOP_SECONDS, 2),
                "end": round(b * HOP_SECONDS + WINDOW_SECONDS, 2),
            })
    events.sort(key=lambda e: e["start"])
    return events[:MAX_EVENTS]


def load(model_dir: str):
    global _model
    with _lock:
        if _model is None:
            import tensorflow as tf

            _model = tf.saved_model.load(model_dir)
            # One call builds the graph, so the first real request isn't slow.
            _model(np.zeros(WINDOW, dtype=np.float32))
    return _model


def tag_file(path: str, model_dir: str, stop_sec: float | None, timeout: float = 600) -> list[dict]:
    model = load(model_dir)
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path, "-vn"]
    if stop_sec:
        cmd += ["-t", f"{stop_sec:.0f}"]
    cmd += ["-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"]

    step = CHUNK_FRAMES * HOP
    # Each call gets the next 60 s plus the rest of its last window.
    span = step + WINDOW - HOP
    parts = []
    buf = np.zeros(0, dtype=np.float32)
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as proc:
        expired = threading.Event()

        def stop():
            expired.set()
            proc.kill()

        watchdog = threading.Timer(timeout, stop)
        watchdog.start()
        try:
            while True:
                raw = proc.stdout.read(step * 4)
                if raw:
                    usable = len(raw) - len(raw) % 4
                    buf = np.concatenate([buf, np.frombuffer(raw[:usable], dtype="<f4")])
                while len(buf) >= span:
                    parts.append(_scores(model, buf[:span]))
                    buf = buf[step:]
                if not raw:
                    break
            if len(buf) > 0 and not expired.is_set():
                parts.append(_scores(model, buf))
            proc.wait()
        finally:
            watchdog.cancel()
            if proc.poll() is None:
                proc.kill()
    if expired.is_set():
        raise TimeoutError("sound tagging took too long")
    if not parts:
        return []
    return detect(np.concatenate(parts))


def _scores(model, wav: np.ndarray) -> np.ndarray:
    wav = np.nan_to_num(wav, nan=0.0, posinf=0.0, neginf=0.0)
    with _lock:
        return model(wav)[0].numpy()
