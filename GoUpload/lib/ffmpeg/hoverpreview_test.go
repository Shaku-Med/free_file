package ffmpeg

import (
	"strings"
	"testing"
)

func TestHoverTargetFor(t *testing.T) {
	cases := []struct {
		duration float64
		want     float64
	}{
		{30, hoverTargetSeconds},
		{600, hoverTargetSeconds},
		{601, hoverLongTargetSeconds},
		{3600, hoverLongTargetSeconds},
	}
	for _, c := range cases {
		if got := hoverTargetFor(c.duration); got != c.want {
			t.Fatalf("duration %.0f: got %.0f want %.0f", c.duration, got, c.want)
		}
	}
}

func TestHoverNeverSamplesTheEnding(t *testing.T) {
	for _, duration := range []float64{60, 600, 3600, 7200} {
		points := hoverSamplePoints(duration)
		if len(points) == 0 {
			t.Fatalf("duration %.0f produced no points", duration)
		}
		lastFrameEnd := points[len(points)-1] + hoverClipSeconds
		limit := duration * hoverTailGuard
		if lastFrameEnd > limit+0.01 {
			t.Fatalf("duration %.0f samples to %.2fs, past the %.2fs guard",
				duration, lastFrameEnd, limit)
		}
	}
}

func TestHoverSpreadsAcrossWholeVideo(t *testing.T) {
	const duration float64 = 3600
	points := hoverSamplePoints(duration)
	last := points[len(points)-1]
	if last < duration*0.5 {
		t.Fatalf("last sample at %.0fs is inside the first half of a %.0fs video", last, duration)
	}
}

func TestHoverStartsAtZero(t *testing.T) {
	points := hoverSamplePoints(300)
	if len(points) == 0 || points[0] != 0 {
		t.Fatalf("expected first sample at 0, got %v", points)
	}
}

func TestHoverClipsDoNotOverlap(t *testing.T) {
	for _, duration := range []float64{20, 60, 600, 3600} {
		points := hoverSamplePoints(duration)
		for i := 1; i < len(points); i++ {
			if points[i] < points[i-1]+hoverClipSeconds {
				t.Fatalf("duration %.0f: clip %d at %.2f overlaps previous at %.2f",
					duration, i, points[i], points[i-1])
			}
		}
	}
}

func TestHoverClipCounts(t *testing.T) {
	if got := len(hoverSamplePoints(300)); got != 5 {
		t.Fatalf("5 min video: got %d clips, want 5", got)
	}
	if got := len(hoverSamplePoints(1800)); got != 7 {
		t.Fatalf("30 min video: got %d clips, want 7", got)
	}
}

func TestHoverShortVideoYieldsNoPoints(t *testing.T) {
	if pts := hoverSamplePoints(4); pts != nil {
		t.Fatalf("4s video should not be sampled, got %v", pts)
	}
	if pts := hoverSamplePoints(0); pts != nil {
		t.Fatalf("zero duration should not be sampled, got %v", pts)
	}
	if pts := hoverSamplePoints(-5); pts != nil {
		t.Fatalf("negative duration should not be sampled, got %v", pts)
	}
}

func TestHoverArgsSeekBeforeInput(t *testing.T) {
	args := buildHoverArgs("in.mp4", "out.mp4", []float64{0, 10, 20}, 2, hoverCRF)
	for i, a := range args {
		if a == "-i" {
			if i < 4 || args[i-4] != "-ss" || args[i-2] != "-t" {
				t.Fatalf("input at %d is not preceded by -ss/-t: %v", i, args)
			}
		}
	}
}

func TestHoverArgsStripAudioAndFaststart(t *testing.T) {
	args := buildHoverArgs("in.mp4", "out.mp4", []float64{0, 10}, 2, hoverCRF)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, " -an ") {
		t.Fatal("preview must be silent")
	}
	if !strings.Contains(joined, "+faststart") {
		t.Fatal("preview must be faststart or it stalls on hover")
	}
	if !strings.Contains(joined, "a=0") {
		t.Fatal("concat must be video only")
	}
}

func TestHoverArgsConcatMatchesClipCount(t *testing.T) {
	args := buildHoverArgs("in.mp4", "out.mp4", []float64{0, 5, 10, 15}, 2, hoverCRF)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "concat=n=4:v=1:a=0") {
		t.Fatalf("concat count does not match inputs: %s", joined)
	}
}
