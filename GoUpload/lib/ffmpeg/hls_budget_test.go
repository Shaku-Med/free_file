package ffmpeg

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestParseRate(t *testing.T) {
	cases := map[string]int{
		"800k": 800000, "1.5M": 1500000, "40M": 40000000, " 2m ": 2000000,
		"128000": 128000, "": 0, "fast": 0, "-1M": 0, "infM": 0, "NaN": 0, "1e300M": 0,
	}
	for in, want := range cases {
		if got := parseRate(in); got != want {
			t.Errorf("parseRate(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestSourceVideoBitrate(t *testing.T) {
	const tenMin = 600.0
	fileBytes := int64(150 << 20) // about 2.1 Mbps over ten minutes
	avg := int(float64(fileBytes)*8/tenMin) - 128000

	cases := []struct {
		name          string
		stream, audio int
		bytes         int64
		seconds       float64
		want          int
	}{
		{"stream tag below the file average", 1000000, 128000, fileBytes, tenMin, 1000000},
		{"stream tag claims more than the file holds", 50000000, 128000, fileBytes, tenMin, avg},
		{"no stream tag", 0, 128000, fileBytes, tenMin, avg},
		{"no duration falls back to the tag", 900000, 0, fileBytes, 0, 900000},
		{"under a second is not trusted", 0, 0, fileBytes, 0.2, 0},
		{"nothing known", 0, 0, 0, 0, 0},
	}
	for _, c := range cases {
		if got := sourceVideoBitrate(c.stream, c.audio, c.bytes, c.seconds); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}

func TestTierRateCap(t *testing.T) {
	src := 3840 * 2160
	if got := tierRateCap(2000000, src, src); got != 6000000 {
		t.Errorf("source size tier = %d, want 3x the source", got)
	}
	// A quarter of the pixels gets 0.25^0.75 of the rate, about 0.354.
	if got := tierRateCap(2000000, src, 1920*1080); got < 2100000 || got > 2150000 {
		t.Errorf("1080p from 4K = %d, want about 2.12M", got)
	}
	if got := tierRateCap(2000000, 1280*720, 1920*1080); got != 6000000 {
		t.Errorf("a tier larger than the source = %d, want no extra room", got)
	}
	for _, zero := range [][3]int{{0, src, src}, {2000000, 0, src}, {2000000, src, 0}} {
		if got := tierRateCap(zero[0], zero[1], zero[2]); got != 0 {
			t.Errorf("tierRateCap%v = %d, want 0 (no cap)", zero, got)
		}
	}
}

func TestCapTierRate(t *testing.T) {
	uhd := QualityTier{Name: "2160p", MaxRate: "20M", BufSize: "40M", Bandwidth: 20000000, CRF: "16"}

	got := capTierRate(uhd, 6000000)
	if got.MaxRate != "6000k" || got.Bandwidth != 6000000 {
		t.Errorf("capped to 6M: maxrate %s bandwidth %d", got.MaxRate, got.Bandwidth)
	}
	if got.BufSize != uhd.BufSize || got.CRF != uhd.CRF || got.Name != uhd.Name {
		t.Errorf("capping changed more than the rate: %+v", got)
	}

	if got := capTierRate(uhd, 100000); got.MaxRate != "5000k" || got.Bandwidth != 5000000 {
		t.Errorf("a tiny source rate must stop at a quarter of the ceiling, got %s / %d", got.MaxRate, got.Bandwidth)
	}

	for _, capBps := range []int{0, 20000000, 90000000} {
		if got := capTierRate(uhd, capBps); got != uhd {
			t.Errorf("cap %d changed the tier: %+v", capBps, got)
		}
	}

	low := QualityTier{Name: "360p", MaxRate: "1M", BufSize: "2M", Bandwidth: 800000}
	if got := capTierRate(low, 500000); got.MaxRate != "500k" || got.Bandwidth != 400000 {
		t.Errorf("360p capped to 500k: maxrate %s bandwidth %d", got.MaxRate, got.Bandwidth)
	}

	reel := QualityTier{Name: "720p", MaxRate: "2.2M", BufSize: "4.4M", Bandwidth: 1800000}
	if got := capTierRate(reel, 1100000); got.MaxRate != "1100k" || got.Bandwidth != 900000 {
		t.Errorf("reel tier capped to half: maxrate %s bandwidth %d", got.MaxRate, got.Bandwidth)
	}
}

func TestLadderForLowBitrate4KStaysNearTheSource(t *testing.T) {
	const srcBps = 2000000
	var sum int
	for _, tier := range selectTiers(3840, 2160) {
		w, h := scaledDims(tier.Width, 3840, 2160)
		sum += parseRate(capTierRate(tier, tierRateCap(srcBps, 3840*2160, w*h)).MaxRate)
	}
	if ratio := float64(sum) / srcBps; ratio > 7 {
		t.Errorf("every quality at its ceiling stores %.1fx the source, want under 7x", ratio)
	}

	var uncapped int
	for _, tier := range selectTiers(3840, 2160) {
		uncapped += parseRate(tier.MaxRate)
	}
	if sum >= uncapped/2 {
		t.Errorf("capped ladder %d is not much below the usual %d", sum, uncapped)
	}
}

func TestOutputBudget(t *testing.T) {
	t.Setenv("GOUpload_HLS_MAX_OUTPUT_RATIO", "")
	t.Setenv("GOUpload_HLS_MIN_OUTPUT_BUDGET_MB", "")
	if got := outputBudget(1 << 30); got != 6<<30 {
		t.Errorf("1 GiB source = %d, want 6 GiB", got)
	}
	if got := outputBudget(1 << 20); got != 128<<20 {
		t.Errorf("1 MiB source = %d, want the 128 MiB minimum", got)
	}

	t.Setenv("GOUpload_HLS_MAX_OUTPUT_RATIO", "3")
	t.Setenv("GOUpload_HLS_MIN_OUTPUT_BUDGET_MB", "0")
	if got := outputBudget(1 << 30); got != 3<<30 {
		t.Errorf("ratio 3 = %d, want 3 GiB", got)
	}

	t.Setenv("GOUpload_HLS_MAX_OUTPUT_RATIO", "-5")
	if got := outputBudget(1 << 20); got != 1<<20 {
		t.Errorf("a ratio under 1 = %d, want it held at 1", got)
	}
}

func TestByteBudgetOver(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "segment_000.ts"), make([]byte, 1000), 0600); err != nil {
		t.Fatal(err)
	}
	var none *byteBudget
	if none.over(dir) {
		t.Error("no budget must never be over")
	}
	if (&byteBudget{used: 500, max: 1500}).over(dir) {
		t.Error("1500 of 1500 is not over")
	}
	b := &byteBudget{used: 501, max: 1500}
	if !b.over(dir) {
		t.Error("1501 of 1500 is over")
	}
	if !errors.Is(b.err(dir), ErrOutputBudget) {
		t.Error("budget error must wrap ErrOutputBudget")
	}
}

func TestExecEncodeStopsAnEncodeThatSpendsItsBudget(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	defer func(p time.Duration) { budgetPoll = p }(budgetPoll)
	budgetPoll = 50 * time.Millisecond

	dir := t.TempDir()
	m3u8 := ffmpegPathArg(filepath.Join(dir, "playlist.m3u8"))
	// Ten minutes of lossless 720p: far past the budget within a second or two.
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=600",
		"-c:v", "libx264", "-preset", "ultrafast", "-qp", "0",
		"-hls_time", "1", "-hls_list_size", "0",
		"-hls_segment_filename", ffmpegPathArg(filepath.Join(dir, "segment_%03d.ts")),
		"-f", "hls", "-y", m3u8}

	start := time.Now()
	segs, err := execEncode(args, m3u8, &byteBudget{used: 1 << 20, max: 4 << 20})
	if !errors.Is(err, ErrOutputBudget) || segs != nil {
		t.Fatalf("got %d segments and err %v, want ErrOutputBudget and nothing kept", len(segs), err)
	}
	if took := time.Since(start); took > time.Minute {
		t.Fatalf("encode ran %s, want it stopped once over budget", took)
	}
}

func TestOutputBudgetStopsLaterQualities(t *testing.T) {
	clip := makeClip(t)
	t.Setenv("GOUpload_HLS_MIN_OUTPUT_BUDGET_MB", "0")
	t.Setenv("GOUpload_HLS_MAX_OUTPUT_RATIO", "1")

	var published []string
	res, err := ConvertToHLSAllQualities(clip, filepath.Join(t.TempDir(), "hls"), HLSOptions{
		SegmentTime: 6,
		Publish: func(dirs []string, _, _ int) error {
			published = append(published, dirs[0])
			return nil
		},
	})
	if err != nil {
		t.Fatalf("a budget stop after going live must not fail the video: %v", err)
	}
	if !errors.Is(res.Partial, ErrOutputBudget) {
		t.Fatalf("partial = %v, want ErrOutputBudget", res.Partial)
	}
	if len(res.Tiers) == 0 || len(res.Tiers) == 3 || len(published) != len(res.Tiers) {
		t.Fatalf("kept %d tiers and published %v, want some but not all of the three", len(res.Tiers), published)
	}
}
