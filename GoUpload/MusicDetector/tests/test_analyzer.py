"""Pure-logic tests for the music gate. No TensorFlow needed - they import only
the aggregation/decision helpers, which keep the model import lazy. `src` is put
on the path by pytest.ini (pythonpath = src)."""

import analyzer
from analyzer import decide_is_music, summarize_segments


def test_song_is_mostly_music():
    segs = [("music", 0, 100), ("speech", 100, 110), ("noEnergy", 110, 130)]
    s = summarize_segments(segs)
    assert s["music_seconds"] == 100
    assert s["speech_seconds"] == 10
    # Silence is excluded from the denominator: 100 / (100 + 10), rounded to 4dp.
    assert s["music_ratio"] == round(100 / 110, 4)
    assert decide_is_music(s, 0.5, 15) is True


def test_vlog_with_background_music_is_not_flagged():
    # Mostly talking, a short musical sting - the false positive we are killing.
    segs = [("speech", 0, 200), ("music", 200, 212)]
    s = summarize_segments(segs)
    assert decide_is_music(s, 0.5, 15) is False


def test_min_music_seconds_gate_blocks_tiny_clips():
    # Ratio is 1.0 (only music + silence) but there are just 8s of music.
    segs = [("music", 0, 8), ("noEnergy", 8, 200)]
    s = summarize_segments(segs)
    assert s["music_ratio"] == 1.0
    assert decide_is_music(s, 0.5, 15) is False


def test_zero_and_negative_duration_segments_ignored():
    segs = [("music", 5, 5), ("music", 10, 9), ("speech", 0, 30)]
    s = summarize_segments(segs)
    assert s["music_seconds"] == 0.0
    assert s["speech_seconds"] == 30


def test_empty_segmentation():
    s = summarize_segments([])
    assert s["music_ratio"] == 0.0
    assert s["music_seconds"] == 0.0
    assert decide_is_music(s, 0.5, 15) is False


def test_stub_mode_produces_a_valid_summary(tmp_path):
    # Stub path (used when the ML stack is absent) must return the normal shape.
    analyzer._stub_mode = True
    try:
        even = tmp_path / "even.bin"
        even.write_bytes(b"x" * 10)
        s = analyzer.analyze_file(str(even))
        assert set(s) >= {"music_seconds", "music_ratio", "voiced_seconds", "segments"}
        assert [x["label"] for x in s["segments"]] == ["music", "speech"]
        assert decide_is_music(s, 0.5, 15) is True  # even size -> mostly music
    finally:
        analyzer._stub_mode = False


def test_threshold_is_inclusive():
    segs = [("music", 0, 50), ("speech", 50, 100)]
    s = summarize_segments(segs)
    assert s["music_ratio"] == 0.5
    assert decide_is_music(s, 0.5, 15) is True
    assert decide_is_music(s, 0.51, 15) is False


def test_segments_are_joined_and_rounded():
    segs = [("music", 0, 1.5), ("music", 1.5, 3), ("speech", 3, 10.004), ("speech", 10.5, 12), ("noEnergy", 12, 12)]
    assert analyzer.merge_segments(segs) == [
        {"label": "music", "start": 0.0, "end": 3.0},
        {"label": "speech", "start": 3.0, "end": 10.0},
        {"label": "speech", "start": 10.5, "end": 12.0},
    ]


def test_segment_list_is_capped(monkeypatch):
    monkeypatch.setattr(analyzer, "MAX_SEGMENTS", 3)
    segs = [("music" if i % 2 else "speech", i, i + 1) for i in range(10)]
    assert len(analyzer.merge_segments(segs)) == 3
