package ffmpeg

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	// ThumbExtractMaxWidth caps width of each stored frame; height scales with aspect (-2).
	// High enough for sharp player / picker thumbnails; no downscale to tiny cells here.
	ThumbExtractMaxWidth = 1920
	ThumbMaxCount        = 200
	ThumbMinInterval     = 1.5
	// JPEG q:v for ffmpeg mjpeg (lower = better). Used only for individual thumb_*.jpg files.
	ThumbExtractQuality = 2
)

// PreviewGridCellSize is the max edge length when building thumbnail_preview.jpg (grid/sprite only).
const PreviewGridCellSize = 160

type Thumbnail struct {
	Path       string
	TimeOffset float64
	Data       []byte
}

type ThumbnailResult struct {
	Thumbnails []Thumbnail
	Duration   float64
	Interval   float64
}

func ExtractThumbnails(videoPath, outputDir string) (*ThumbnailResult, error) {
	duration, err := GetDuration(videoPath)
	if err != nil {
		return nil, fmt.Errorf("get duration: %w", err)
	}
	if duration <= 0 {
		return nil, fmt.Errorf("invalid duration: %f", duration)
	}

	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}

	interval := duration / float64(ThumbMaxCount)
	if interval < ThumbMinInterval {
		interval = ThumbMinInterval
	}

	// Target timestamps (same spacing as old fps=1/interval, max ThumbMaxCount frames).
	var times []float64
	const eps = 0.05
	for i := 0; i < ThumbMaxCount; i++ {
		t := float64(i) * interval
		if t >= duration-eps {
			break
		}
		if t > duration-0.25 {
			t = math.Max(0, duration-0.25)
		}
		times = append(times, t)
	}
	if len(times) == 0 {
		times = append(times, 0)
	}

	// Many sequential seeks; allow headroom for long 4K / multi‑GB sources (up to ThumbMaxCount frames).
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Hour)
	defer cancel()

	scaleVF := fmt.Sprintf("scale='min(%d,iw)':-2", ThumbExtractMaxWidth)

	for i, t := range times {
		outPath := filepath.Join(outputDir, fmt.Sprintf("thumb_%04d.jpg", i))
		// -ss before -i: input seek (does not decode the whole file; avoids OOM on multi‑GB MP4/MOV).
		args := []string{
			"-hide_banner", "-loglevel", "error",
			"-nostdin",
			"-fflags", "+genpts",
			"-ss", fmt.Sprintf("%.3f", t),
			"-analyzeduration", "10M",
			"-probesize", "10M",
			"-err_detect", "ignore_err",
			"-i", videoPath,
			"-map", "0:v:0",
			"-threads", "1",
			"-vf", scaleVF,
			"-vframes", "1",
			"-q:v", strconv.Itoa(ThumbExtractQuality),
			"-y",
			outPath,
		}

		frameCtx, frameCancel := context.WithTimeout(ctx, 8*time.Minute)
		cmd := exec.CommandContext(frameCtx, "ffmpeg", args...)
		var stderr limitedWriter
		stderr.max = 256 << 10
		cmd.Stderr = &stderr
		runErr := cmd.Run()
		frameCancel()
		if runErr != nil {
			return nil, fmt.Errorf("ffmpeg frame %d @ %.2fs: %w, stderr: %s", i, t, runErr, stderr.String())
		}
	}

	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return nil, err
	}

	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "thumb_") && strings.HasSuffix(e.Name(), ".jpg") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	thumbs := make([]Thumbnail, 0, len(names))
	for i, n := range names {
		p := filepath.Join(outputDir, n)
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var tOff float64
		if i < len(times) {
			tOff = times[i]
		} else {
			tOff = float64(i) * interval
		}
		if tOff > duration {
			tOff = duration
		}
		thumbs = append(thumbs, Thumbnail{Path: p, TimeOffset: tOff, Data: data})
	}

	if len(thumbs) == 0 {
		return nil, fmt.Errorf("no thumbnails extracted")
	}

	return &ThumbnailResult{
		Thumbnails: thumbs,
		Duration:   duration,
		Interval:   interval,
	}, nil
}

func GetDuration(videoPath string) (float64, error) {
	// ffprobe reads container metadata only — ffmpeg -i on multi‑GB files can use huge RAM and get SIGKILL (OOM).
	args := []string{
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		videoPath,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffprobe", args...)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &limitedWriter{max: 64 << 10}

	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("ffprobe duration: %w", err)
	}

	s := strings.TrimSpace(stdout.String())
	dur, err := strconv.ParseFloat(s, 64)
	if err != nil || dur <= 0 {
		return 0, fmt.Errorf("invalid duration: %q", s)
	}
	return dur, nil
}

func CleanupThumbnails(thumbnails []Thumbnail) {
	for _, t := range thumbnails {
		_ = os.Remove(t.Path)
	}
}
