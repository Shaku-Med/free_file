package ffmpeg

import (
	"strings"
	"testing"
)

func hasFlagValue(args []string, flag, value string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag && args[i+1] == value {
			return true
		}
	}
	return false
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
}

func TestSelectReelTiersCapsAt720(t *testing.T) {
	cases := []struct {
		name          string
		w, h          int
		wantCount     int
		wantTopTierPx int // target width (short side) of the largest rendition
		wantHasLow    bool
	}{
		{"portrait 1080x1920", 1080, 1920, 2, 720, true},
		{"portrait 720x1280", 720, 1280, 2, 720, true},
		{"portrait 480x854", 480, 854, 1, 480, false},
		{"tiny 360x640", 360, 640, 1, 360, false},
		{"landscape reel 1920x1080", 1920, 1080, 2, 720, true},
		{"square 1000x1000", 1000, 1000, 2, 720, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tiers := selectReelTiers(c.w, c.h)
			if len(tiers) != c.wantCount {
				t.Fatalf("tier count = %d, want %d (%v)", len(tiers), c.wantCount, tiers)
			}
			top := tiers[len(tiers)-1]
			if top.Width != c.wantTopTierPx {
				t.Errorf("top target width = %d, want %d", top.Width, c.wantTopTierPx)
			}
			for _, tr := range tiers {
				if tr.Width > 720 {
					t.Errorf("tier %s exceeds 720 cap: %d", tr.Name, tr.Width)
				}
			}
			if c.wantHasLow && tiers[0].Width != 480 {
				t.Errorf("expected a 480 rung, got %d", tiers[0].Width)
			}
		})
	}
}

func TestScaledDimsAspectAndParity(t *testing.T) {
	// Portrait: 720 wide from a 1080x1920 source → 720x1280.
	w, h := scaledDims(720, 1080, 1920)
	if w != 720 || h != 1280 {
		t.Errorf("portrait 720 => %dx%d, want 720x1280", w, h)
	}
	// Never upscale: 1280 target from a 640-wide source stays 640.
	w, _ = scaledDims(1280, 640, 360)
	if w != 640 {
		t.Errorf("no-upscale width = %d, want 640", w)
	}
	// Always even (encoders reject odd dimensions).
	w, h = scaledDims(641, 641, 361)
	if w%2 != 0 || h%2 != 0 {
		t.Errorf("dims not even: %dx%d", w, h)
	}
}

func TestAudioRungForShort(t *testing.T) {
	// Audio quality tracks video: low resolution -> low audio, high -> high.
	cases := []struct {
		short  int
		wantID string
		wantBR string
	}{
		{360, "low", "64k"},
		{480, "low", "64k"},
		{720, "mid", "128k"},
		{1080, "mid", "128k"},
		{1440, "high", "192k"},
		{2160, "high", "192k"},
	}
	for _, c := range cases {
		got := audioRungForShort(c.short)
		if got.id != c.wantID || got.bitrate != c.wantBR {
			t.Errorf("audioRungForShort(%d) = %+v, want {%s %s}", c.short, got, c.wantID, c.wantBR)
		}
	}
}

func TestCapAudioBitrate(t *testing.T) {
	// No source cap: target passes through.
	if got := capAudioBitrate("128k", 0); got != "128k" {
		t.Errorf("no-cap = %s, want 128k", got)
	}
	// Low-bitrate source is not upsampled.
	if got := capAudioBitrate("128k", 64000); got != "64k" {
		t.Errorf("low source = %s, want 64k", got)
	}
	// Rich source does not raise the target.
	if got := capAudioBitrate("64k", 320000); got != "64k" {
		t.Errorf("rich source = %s, want 64k", got)
	}
	// Floor.
	if got := capAudioBitrate("64k", 8000); got != "32k" {
		t.Errorf("floor = %s, want 32k", got)
	}
}

func TestAudioBitrateBps(t *testing.T) {
	for in, want := range map[string]int{"128k": 128000, "96k": 96000, "1.5M": 128000 /*non-int falls back*/, "2M": 2000000, "": 128000} {
		if got := audioBitrateBps(in); got != want {
			t.Errorf("audioBitrateBps(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestBuildTierArgsVideoOnlyDropsAudioAndStripsMeta(t *testing.T) {
	tier := allTiers[2]
	args := buildTierArgs("in.mp4", "out.m3u8", "seg_%03d.ts", HLSOptions{SegmentTime: 10}, tier, false, true /*hasAudio*/, true /*videoOnly*/)
	joined := strings.Join(args, " ")

	if !hasFlag(args, "-an") {
		t.Errorf("video-only tier must pass -an; args: %s", joined)
	}
	if strings.Contains(joined, "0:a:0") {
		t.Errorf("video-only tier must not map audio; args: %s", joined)
	}
	if !hasFlagValue(args, "-map_metadata", "-1") || !hasFlagValue(args, "-map_chapters", "-1") {
		t.Errorf("tier must strip metadata; args: %s", joined)
	}
}

func TestBuildTierArgsMuxedKeepsAudio(t *testing.T) {
	tier := allTiers[2]
	args := buildTierArgs("in.mp4", "out.m3u8", "seg_%03d.ts", HLSOptions{SegmentTime: 10}, tier, false, true, false /*muxed*/)
	joined := strings.Join(args, " ")
	if !hasFlagValue(args, "-c:a", "aac") || !hasFlagValue(args, "-b:a", tier.AudioBR) {
		t.Errorf("muxed tier must encode audio; args: %s", joined)
	}
	if hasFlag(args, "-an") {
		t.Errorf("muxed tier must not pass -an; args: %s", joined)
	}
}

func TestBuildAudioArgsIsAudioOnlyAndStripsMeta(t *testing.T) {
	args := buildAudioArgs("in.mp4", "audio.m3u8", "seg_%03d.ts", HLSOptions{SegmentTime: 10}, "128k")
	joined := strings.Join(args, " ")

	if !hasFlag(args, "-vn") {
		t.Errorf("audio rendition must pass -vn; args: %s", joined)
	}
	if !hasFlagValue(args, "-c:a", "aac") || !hasFlagValue(args, "-b:a", "128k") {
		t.Errorf("audio rendition must encode aac@128k; args: %s", joined)
	}
	if !hasFlagValue(args, "-map_metadata", "-1") {
		t.Errorf("audio rendition must strip metadata; args: %s", joined)
	}
	if strings.Contains(joined, "-c:v") || strings.Contains(joined, "libx264") {
		t.Errorf("audio rendition must not encode video; args: %s", joined)
	}
}
