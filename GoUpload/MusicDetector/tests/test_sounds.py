"""Event building for sound tags. numpy only, no TensorFlow."""

import pytest

np = pytest.importorskip("numpy")

import sounds  # noqa: E402

LAUGH, SHOUT, COUGH, APPLAUSE = 13, 6, 42, 62


def frames(n):
    return np.zeros((n, 521), dtype=np.float32)


def test_a_laugh_becomes_one_event_across_a_short_dip():
    s = frames(20)
    s[4:7, LAUGH] = 0.6
    s[8:10, LAUGH] = 0.5  # frame 7 dips, bridged
    events = sounds.detect(s)
    assert events == [{"label": "Laughter", "start": round(4 * 0.48, 2), "end": round(9 * 0.48 + 0.96, 2)}]


def test_weak_or_too_short_hits_are_dropped():
    s = frames(20)
    s[3, LAUGH] = 0.9  # one frame, laughter needs two
    s[10:13, APPLAUSE] = 0.35  # above the frame bar, never reaches its peak bar
    assert sounds.detect(s) == []


def test_a_shout_over_music_is_a_singer_but_applause_still_counts():
    s = frames(10)
    s[:, sounds.MUSIC_CLASS] = 0.9
    s[2:4, SHOUT] = 0.9
    s[6:9, APPLAUSE] = 0.9
    assert [e["label"] for e in sounds.detect(s)] == ["Applause"]


def test_each_frame_goes_to_its_strongest_tag():
    s = frames(6)
    s[1:3, COUGH] = 0.7
    s[1:3, LAUGH] = 0.95
    assert [e["label"] for e in sounds.detect(s)] == ["Laughter"]


def test_bad_shapes_give_nothing():
    assert sounds.detect(np.zeros((0, 521))) == []
    assert sounds.detect(np.zeros((5, 10))) == []
    assert sounds.detect(np.zeros(5)) == []


def test_events_are_capped_and_in_time_order():
    s = frames(sounds.MAX_EVENTS * 6)
    for i in range(0, len(s), 3):
        s[i, COUGH] = 0.9
    events = sounds.detect(s)
    assert len(events) == sounds.MAX_EVENTS
    assert all(a["start"] <= b["start"] for a, b in zip(events, events[1:]))
