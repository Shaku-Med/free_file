package ffmpeg

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Short silent MP4 stitched from clips across the video, for hovering a card.
// Every timing decision comes from the ffprobe duration, never from client input.

const (
	hoverClipSeconds = 2.0

	hoverTargetSeconds     = 10.0
	hoverLongTargetSeconds = 15.0
	hoverLongVideoSeconds  = 600.0

	// Never sample the last 15%, where endings and credits live.
	hoverTailGuard = 0.85

	hoverLongEdge = 480
	hoverFps      = 15
	hoverCRF      = "31"

	hoverRetryCRF = "36"
	hoverMaxBytes = 2 << 20

	hoverPreviewName = "hover_preview.mp4"

	// HoverPreviewName is the on-disk name callers append to a storage prefix.
	HoverPreviewName = hoverPreviewName
)

func hoverTargetFor(duration float64) float64 {
	if duration > hoverLongVideoSeconds {
		return hoverLongTargetSeconds
	}
	return hoverTargetSeconds
}

// Evenly spaced clip starts across [0, duration*hoverTailGuard].
// Returns nil when there is too little material to jump around in.
func hoverSamplePoints(duration float64) []float64 {
	if duration <= 0 {
		return nil
	}
	window := duration * hoverTailGuard
	if window < hoverClipSeconds*2 {
		return nil
	}

	want := int(hoverTargetFor(duration) / hoverClipSeconds)
	if fits := int(window / hoverClipSeconds); want > fits {
		want = fits
	}
	if want < 1 {
		return nil
	}
	if want == 1 {
		return []float64{0}
	}

	step := (window - hoverClipSeconds) / float64(want-1)
	points := make([]float64, 0, want)
	for i := 0; i < want; i++ {
		points = append(points, roundSeconds(float64(i)*step))
	}
	return points
}

func roundSeconds(v float64) float64 {
	if v < 0 {
		return 0
	}
	return float64(int64(v*1000+0.5)) / 1000
}

// Caps the long edge so portrait uploads do not produce oversized previews.
var hoverScaleFilter = fmt.Sprintf(
	"scale=w='if(gte(iw,ih),%d,-2)':h='if(gte(iw,ih),-2,%d)'",
	hoverLongEdge, hoverLongEdge,
)

// Each clip is its own input with -ss before -i so ffmpeg seeks by keyframe.
// A single input with trim filters decodes the whole file once per clip, which
// turns a long video from seconds into minutes.
func buildHoverArgs(src, dst string, points []float64, clipLen float64, crf string) []string {
	args := []string{"-hide_banner", "-loglevel", "error", "-y"}

	for _, p := range points {
		args = append(args,
			"-ss", strconv.FormatFloat(p, 'f', 3, 64),
			"-t", strconv.FormatFloat(clipLen, 'f', 3, 64),
			"-i", src,
		)
	}

	filter := ""
	for i := range points {
		filter += fmt.Sprintf("[%d:v]%s,fps=%d,setsar=1[c%d];", i, hoverScaleFilter, hoverFps, i)
	}
	for i := range points {
		filter += fmt.Sprintf("[c%d]", i)
	}
	filter += fmt.Sprintf("concat=n=%d:v=1:a=0[v]", len(points))

	args = append(args,
		"-filter_complex", filter,
		"-map", "[v]",
		"-an",
		"-c:v", "libx264",
		"-preset", "veryfast",
		"-crf", crf,
		"-profile:v", "main",
		"-pix_fmt", "yuv420p",
		// Without faststart the preview stalls on hover regardless of size.
		"-movflags", "+faststart",
		dst,
	)
	return args
}

// duration must come from ffprobe (VideoInfo.Duration / GetDuration).
func BuildHoverPreview(videoPath, outDir string, duration float64) (string, error) {
	if duration <= 0 {
		return "", fmt.Errorf("invalid duration: %f", duration)
	}
	if videoPath == "" || outDir == "" {
		return "", fmt.Errorf("hover preview: empty path")
	}

	points := hoverSamplePoints(duration)
	clipLen := hoverClipSeconds
	if points == nil {
		points = []float64{0}
		clipLen = duration
	}

	dst := filepath.Join(outDir, hoverPreviewName)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	run := func(crf string) error {
		cmd := FFmpegCommand(ctx, buildHoverArgs(videoPath, dst, points, clipLen, crf)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("hover preview encode: %w: %s", err, string(out))
		}
		return nil
	}

	if err := run(hoverCRF); err != nil {
		_ = os.Remove(dst)
		return "", err
	}

	st, err := os.Stat(dst)
	if err != nil {
		return "", fmt.Errorf("hover preview stat: %w", err)
	}
	if st.Size() > hoverMaxBytes {
		if err := run(hoverRetryCRF); err != nil {
			_ = os.Remove(dst)
			return "", err
		}
	}

	return dst, nil
}
