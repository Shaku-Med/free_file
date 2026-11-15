"""Split a track into drums, bass, other and vocals with Demucs (htdemucs) and
measure each instrument band of the separated stems over time.

GoUpload turns those band curves into audio_stems.json (onsets and wave
envelopes for the player's visualizer), with the same onset picking it uses
for its own instant analysis. Doing that on separated stems instead of the
full mix is the whole point: a bass line or a voice no longer sets off kicks
and snares.
"""

from __future__ import annotations

import hashlib
import importlib.util
import logging
import os
import subprocess
import sys
import threading
import types

import numpy as np

log = logging.getLogger("stemsapi")

SAMPLE_RATE = 44100
# One analysis frame every 1024 samples (2048 wide) is ~43 per second, the same
# grid GoUpload's own analysis uses at 22050 Hz with a 512 hop.
FRAME = 2048
HOP = 1024
FPS = SAMPLE_RATE / HOP
# Separated two minutes at a time with 2 s of real audio either side, so memory
# stays flat however long the track is and no chunk edge lands inside a hit.
CHUNK = 5168 * HOP
CONTEXT = 86 * HOP
# Overlap between Demucs' own 8 s windows. Its default of 0.25 buys a sliver of
# audio quality nobody hears in an energy curve, for a fifth more work.
OVERLAP = 0.1

SOURCES = ("drums", "bass", "other", "vocals")

# band -> (stem, low Hz, high Hz). The snare is read from its crack, above the
# kick's body and below the cymbals.
BANDS = {
    "kick": ("drums", 30.0, 120.0),
    "snare": ("drums", 1000.0, 5000.0),
    "hihat": ("drums", 7000.0, 16000.0),
    "bass": ("bass", 30.0, 400.0),
    "other": ("other", 200.0, 5000.0),
}

_lock = threading.Lock()
_model = None


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


class _AbsentTorchaudio(types.ModuleType):
    def __getattr__(self, name):
        raise AttributeError(f"torchaudio is not installed (wanted torchaudio.{name})")


def allow_missing_torchaudio() -> None:
    """htdemucs imports openunmix.filtering, and openunmix imports torchaudio at
    the top of its package for file helpers this service never calls (ffmpeg
    decodes the audio). The image leaves torchaudio out, so a placeholder lets
    that import through while any real use still fails loudly."""
    if isinstance(sys.modules.get("torchaudio"), types.ModuleType):
        return
    if importlib.util.find_spec("torchaudio") is None:
        sys.modules["torchaudio"] = _AbsentTorchaudio("torchaudio")


def load_model(path: str, expected_sha256: str):
    """Load the pinned htdemucs checkpoint. The checkpoint is a pickle (it names
    its model class), so it is only unpickled once its hash matches the pin."""
    global _model
    if _model is not None:
        return _model
    allow_missing_torchaudio()
    import torch
    from demucs.states import load_model as demucs_load

    actual = sha256_file(path)
    if actual != expected_sha256.lower():
        raise RuntimeError(f"stems model hash mismatch: {actual}")
    package = torch.load(path, map_location="cpu", weights_only=False)
    model = demucs_load(package)
    model.eval()
    if tuple(model.sources) != SOURCES or model.samplerate != SAMPLE_RATE:
        raise RuntimeError(f"unexpected stems model: {model.sources} @ {model.samplerate}")
    _model = model
    return model


def decode(path: str, max_seconds: float, timeout: float, input_format: str | None = None) -> np.ndarray:
    """Stereo float32 [2, n] at 44.1 kHz, at most max_seconds long. Naming the
    input_format stops ffmpeg probing for one, so a file posing as a playlist
    can't make it open other files or URLs."""
    forced = ["-f", input_format] if input_format else []
    cmd = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        *forced, "-i", path, "-vn", "-map", "0:a:0",
        "-t", f"{max_seconds:.0f}",
        "-ac", "2", "-ar", str(SAMPLE_RATE),
        "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    raw = proc.stdout
    if proc.returncode != 0 and not raw:
        raise ValueError("could not decode audio")
    usable = len(raw) - len(raw) % 8
    pcm = np.frombuffer(raw[:usable], dtype="<f4").reshape(-1, 2).T
    return np.ascontiguousarray(np.nan_to_num(pcm, nan=0.0, posinf=0.0, neginf=0.0))


def frame_count(n: int) -> int:
    return 0 if n < FRAME else 1 + (n - FRAME) // HOP


def _band_bins() -> dict[str, tuple[str, int, int]]:
    bin_hz = SAMPLE_RATE / FRAME
    out = {}
    for name, (stem, lo, hi) in BANDS.items():
        lo_bin = max(1, int(np.floor(lo / bin_hz)))
        hi_bin = min(FRAME // 2 - 1, int(np.ceil(hi / bin_hz)))
        out[name] = (stem, lo_bin, hi_bin)
    return out


_WINDOW = np.hanning(FRAME).astype(np.float32)
_BINS = _band_bins()


def band_energy(mono: np.ndarray, stem: str, first: int, frames: int, offset: int) -> dict[str, np.ndarray]:
    """Mean magnitude of every band read from `stem`, for frames
    [first, first+frames) of a stem whose sample 0 sits at global `offset`."""
    out = {}
    for start in range(0, frames, 2048):
        count = min(2048, frames - start)
        starts = np.arange(first + start, first + start + count) * HOP - offset
        idx = starts[:, None] + np.arange(FRAME)[None, :]
        spec = np.abs(np.fft.rfft(mono[idx] * _WINDOW, axis=1))
        for name, (band_stem, lo, hi) in _BINS.items():
            if band_stem == stem:
                out.setdefault(name, []).append(spec[:, lo:hi + 1].mean(axis=1))
    return {name: np.concatenate(parts) for name, parts in out.items()}


def separate_bands(model, wav: np.ndarray, threads: int) -> dict:
    """Band curves for the whole track, separated chunk by chunk."""
    allow_missing_torchaudio()
    import torch
    from demucs.apply import apply_model

    n = wav.shape[1]
    total = frame_count(n)
    series = {name: np.zeros(total, dtype=np.float32) for name in BANDS}
    if total == 0:
        return {"fps": FPS, "duration": n / SAMPLE_RATE, "frames": 0, "series": series}

    # Demucs expects a normalised mix; the same scale is kept for every chunk.
    ref = wav.mean(axis=0)
    mean, std = float(ref.mean()), float(ref.std()) or 1.0
    del ref

    stem_index = {s: i for i, s in enumerate(SOURCES)}
    torch.set_num_threads(max(1, threads))
    with _lock, torch.inference_mode():
        for start in range(0, n, CHUNK):
            end = min(start + CHUNK, n)
            first = start // HOP
            last = min(total, (end + HOP - 1) // HOP)
            if last <= first:
                continue
            seg_lo = max(0, start - CONTEXT)
            seg_hi = min(n, end + CONTEXT + FRAME)
            mix = torch.from_numpy((wav[:, seg_lo:seg_hi] - mean) / std).unsqueeze(0)
            out = apply_model(model, mix, shifts=0, split=True, overlap=OVERLAP, progress=False)[0]
            stems = (out.mean(dim=1) * std).numpy()
            del out
            # Frames that would run past the separated audio are the track's
            # last few, which stay at zero.
            frames = min(last - first, (seg_hi - FRAME) // HOP - first + 1)
            if frames <= 0:
                continue
            for stem in {b[0] for b in BANDS.values()}:
                for name, curve in band_energy(stems[stem_index[stem]], stem, first, frames, seg_lo).items():
                    series[name][first:first + frames] = curve
    return {"fps": FPS, "duration": n / SAMPLE_RATE, "frames": total, "series": series}


def to_json(result: dict) -> dict:
    return {
        "fps": round(result["fps"], 6),
        "duration": round(result["duration"], 3),
        "frames": result["frames"],
        "series": {
            name: [float(f"{v:.4g}") for v in curve.tolist()]
            for name, curve in result["series"].items()
        },
    }
