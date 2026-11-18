package ffmpeg

import (
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"goupload/lib/env"
)

// ErrOutputBudget is why encoding stopped when the stored renditions would
// pass the byte budget set from the source size.
var ErrOutputBudget = errors.New("hls: output over budget")

const (
	// x264 veryfast with fastdecode needs up to about 3x the bits of an AV1 or
	// HEVC source to hold its look.
	srcRateMultiple = 3.0
	// A capped tier keeps at least this share of its usual ceiling, so a low
	// bitrate source still gets room for detail.
	rateFloorDivisor = 4
)

var budgetPoll = 5 * time.Second

// parseRate reads an ffmpeg rate such as "800k" or "1.5M" as bits per second.
// Zero means it could not be read.
func parseRate(s string) int {
	s = strings.ToLower(strings.TrimSpace(s))
	mult := 1.0
	switch {
	case strings.HasSuffix(s, "k"):
		mult, s = 1e3, strings.TrimSuffix(s, "k")
	case strings.HasSuffix(s, "m"):
		mult, s = 1e6, strings.TrimSuffix(s, "m")
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(v) || v <= 0 || v*mult > 1e12 {
		return 0
	}
	return int(v * mult)
}

func formatRate(bps int) string {
	return strconv.Itoa(bps/1000) + "k"
}

// sourceVideoBitrate estimates the source's video bits per second. Stream tags
// can claim anything, so the average the file size and duration allow wins
// when it is lower. Zero means unknown.
func sourceVideoBitrate(streamBps, audioBps int, fileBytes int64, seconds float64) int {
	avg := 0
	if fileBytes > 0 && seconds >= 1 {
		avg = int(float64(fileBytes) * 8 / seconds)
		if audioBps > 0 && audioBps < avg {
			avg -= audioBps
		}
	}
	if streamBps > 0 && (avg == 0 || streamBps < avg) {
		return streamBps
	}
	return avg
}

// tierRateCap is the most a rendition of outPixels should spend on a source of
// srcPixels at srcBps. Bits needed grow slower than pixel count, hence the
// 0.75 power. Zero means no cap.
func tierRateCap(srcBps, srcPixels, outPixels int) int {
	if srcBps <= 0 || srcPixels <= 0 || outPixels <= 0 {
		return 0
	}
	scale := math.Pow(math.Min(1, float64(outPixels)/float64(srcPixels)), 0.75)
	return int(float64(srcBps) * srcRateMultiple * scale)
}

// capTierRate lowers the tier's maxrate (also the nvenc -b:v) to capBps. The
// buffer stays as is: a still image or slideshow needs one big keyframe per
// segment while its long run rate stays under the cap.
func capTierRate(t QualityTier, capBps int) QualityTier {
	maxBps := parseRate(t.MaxRate)
	if capBps <= 0 || maxBps <= 0 {
		return t
	}
	if floor := maxBps / rateFloorDivisor; capBps < floor {
		capBps = floor
	}
	if capBps >= maxBps {
		return t
	}
	t.MaxRate = formatRate(capBps)
	t.Bandwidth = int(int64(t.Bandwidth) * int64(capBps) / int64(maxBps))
	return t
}

// outputBudget is how many bytes every rendition of one video may take in all:
// GOUpload_HLS_MAX_OUTPUT_RATIO times the source (default 6), never less than
// GOUpload_HLS_MIN_OUTPUT_BUDGET_MB (default 128) so short clips are untouched.
func outputBudget(sourceBytes int64) int64 {
	ratio := env.GetInt64("GOUpload_HLS_MAX_OUTPUT_RATIO", 6)
	ratio = max(1, min(ratio, 100))
	minMB := env.GetInt64("GOUpload_HLS_MIN_OUTPUT_BUDGET_MB", 128)
	minMB = max(0, min(minMB, 64<<10))
	return max(sourceBytes*ratio, minMB<<20)
}

// byteBudget is what one encode may still write: used bytes are already kept
// from earlier renditions.
type byteBudget struct {
	used, max int64
}

func (b *byteBudget) over(dir string) bool {
	return b != nil && b.used+dirBytes(dir) > b.max
}

func (b *byteBudget) err(dir string) error {
	return fmt.Errorf("%w: %d of %d bytes", ErrOutputBudget, b.used+dirBytes(dir), b.max)
}

// watch calls kill once the encode writing into dir spends the budget.
func (b *byteBudget) watch(dir string, kill func()) (stop func()) {
	if b == nil {
		return func() {}
	}
	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(budgetPoll)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				if b.over(dir) {
					kill()
					return
				}
			}
		}
	}()
	return func() {
		close(done)
		wg.Wait()
	}
}

// dirBytes sums the files directly in dir. Rendition folders are flat.
func dirBytes(dir string) int64 {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	var n int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if info, err := e.Info(); err == nil {
			n += info.Size()
		}
	}
	return n
}
