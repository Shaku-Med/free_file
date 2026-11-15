"""Chunking must not change the result: with a stand-in "model" that hands the
mix back as every stem, the stitched band curves have to equal the curves of
the whole track measured in one go."""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

torch = pytest.importorskip("torch")
pytest.importorskip("demucs")

import separator  # noqa: E402


class EchoModel:
    sources = list(separator.SOURCES)
    samplerate = separator.SAMPLE_RATE


def echo_apply(model, mix, **_):
    return mix.unsqueeze(1).repeat(1, len(model.sources), 1, 1)


@pytest.fixture(autouse=True)
def patch_apply(monkeypatch):
    import demucs.apply

    monkeypatch.setattr(demucs.apply, "apply_model", echo_apply)


def test_chunks_stitch_into_the_whole_track():
    rng = np.random.default_rng(1)
    n = int(separator.SAMPLE_RATE * 250.3)
    t = np.arange(n) / separator.SAMPLE_RATE
    mono = (0.3 * np.sin(2 * np.pi * 60 * t) * (np.sin(2 * np.pi * 0.5 * t) > 0) + 0.05 * rng.standard_normal(n)).astype(np.float32)
    wav = np.stack([mono, mono])

    res = separator.separate_bands(EchoModel(), wav, threads=1)
    total = separator.frame_count(n)
    assert res["frames"] == total
    # Demucs is fed a mix with its DC offset taken out, so the echo is too.
    centred = mono - mono.mean()
    for name, (stem, _, _) in separator.BANDS.items():
        whole = separator.band_energy(centred, stem, 0, total, 0)[name]
        np.testing.assert_allclose(res["series"][name], whole, rtol=1e-4, atol=1e-6)


def test_short_audio_has_no_frames():
    wav = np.zeros((2, separator.FRAME - 1), dtype=np.float32)
    res = separator.separate_bands(EchoModel(), wav, threads=1)
    assert res["frames"] == 0


def test_json_is_compact_and_finite():
    res = {"fps": separator.FPS, "duration": 1.0, "frames": 2,
           "series": {k: np.array([0.123456789, 2.0], dtype=np.float32) for k in separator.BANDS}}
    out = separator.to_json(res)
    assert out["series"]["kick"] == [0.1235, 2.0]


def test_model_hash_is_checked_before_loading(tmp_path):
    bad = tmp_path / "model.th"
    bad.write_bytes(b"not a model")
    separator._model = None
    with pytest.raises(RuntimeError, match="hash mismatch"):
        separator.load_model(str(bad), "0" * 64)
