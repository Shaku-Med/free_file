package ffmpeg

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	ThumbCellSize   = 160
	ThumbMaxCount   = 200
	ThumbMinInterval = 1.5
)

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

	vf := fmt.Sprintf("fps=1/%.2f,scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d:(iw-%d)/2:(ih-%d)/2",
		interval, ThumbCellSize, ThumbCellSize, ThumbCellSize, ThumbCellSize, ThumbCellSize, ThumbCellSize)

	pattern := filepath.Join(outputDir, "thumb_%04d.jpg")
	args := []string{
		"-fflags", "+genpts+igndts",
		"-analyzeduration", "100M",
		"-probesize", "100M",
		"-err_detect", "ignore_err",
		"-i", videoPath,
		"-vf", vf,
		"-vframes", strconv.Itoa(ThumbMaxCount),
		"-q:v", "3",
		"-y",
		pattern,
	}

	cmd := exec.Command("ffmpeg", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg: %w, stderr: %s", err, stderr.String())
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
		t := float64(i) * interval
		if t > duration {
			t = duration
		}
		thumbs = append(thumbs, Thumbnail{Path: p, TimeOffset: t, Data: data})
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
	args := []string{
		"-fflags", "+genpts+igndts",
		"-analyzeduration", "100M",
		"-probesize", "100M",
		"-err_detect", "ignore_err",
		"-i", videoPath,
	}

	cmd := exec.Command("ffmpeg", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	_ = cmd.Run()

	re := regexp.MustCompile(`Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)`)
	matches := re.FindStringSubmatch(stderr.String())
	if len(matches) < 4 {
		return 0, fmt.Errorf("duration not found")
	}

	hours, _ := strconv.ParseFloat(matches[1], 64)
	minutes, _ := strconv.ParseFloat(matches[2], 64)
	seconds, _ := strconv.ParseFloat(matches[3], 64)

	return hours*3600 + minutes*60 + seconds, nil
}

func CleanupThumbnails(thumbnails []Thumbnail) {
	for _, t := range thumbnails {
		_ = os.Remove(t.Path)
	}
}
