package worker

import (
	"testing"

	"goupload/lib/ffmpeg"
)

func mkThumbs(n int) []ffmpeg.Thumbnail {
	t := make([]ffmpeg.Thumbnail, n)
	for i := range t {
		t[i] = ffmpeg.Thumbnail{Data: []byte{byte(i)}}
	}
	return t
}

func indices(b [][]byte) []int {
	out := make([]int, len(b))
	for i := range b {
		out[i] = int(b[i][0])
	}
	return out
}

func TestSampleFrameData(t *testing.T) {
	// n == 1 picks the middle frame.
	if got := indices(sampleFrameData(mkThumbs(11), 1)); len(got) != 1 || got[0] != 5 {
		t.Fatalf("n=1 want [5], got %v", got)
	}

	// n >= count returns every frame.
	if got := sampleFrameData(mkThumbs(3), 8); len(got) != 3 {
		t.Fatalf("n>=count want 3 frames, got %d", len(got))
	}

	// Evenly spaced across the video, first and last included, strictly
	// increasing, never more than n.
	got := indices(sampleFrameData(mkThumbs(100), 5))
	if len(got) != 5 {
		t.Fatalf("want 5 samples, got %d (%v)", len(got), got)
	}
	if got[0] != 0 || got[len(got)-1] != 99 {
		t.Fatalf("want first=0 last=99, got %v", got)
	}
	for i := 1; i < len(got); i++ {
		if got[i] <= got[i-1] {
			t.Fatalf("not strictly increasing / deduped: %v", got)
		}
	}

	// Empty input is safe.
	if sampleFrameData(nil, 5) != nil {
		t.Fatal("nil thumbs should return nil")
	}
}

func TestVisionFrameSamples(t *testing.T) {
	t.Setenv("VISION_FRAME_SAMPLES", "")
	if n := visionFrameSamples(); n != 6 {
		t.Fatalf("default want 6, got %d", n)
	}
	t.Setenv("VISION_FRAME_SAMPLES", "12")
	if n := visionFrameSamples(); n != 12 {
		t.Fatalf("want 12, got %d", n)
	}
	t.Setenv("VISION_FRAME_SAMPLES", "999")
	if n := visionFrameSamples(); n != 30 {
		t.Fatalf("clamp want 30, got %d", n)
	}
	t.Setenv("VISION_FRAME_SAMPLES", "nonsense")
	if n := visionFrameSamples(); n != 6 {
		t.Fatalf("invalid want default 6, got %d", n)
	}
}
