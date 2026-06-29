package ffmpeg

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// ExtractAudioClip writes a compact mono 16 kHz WAV of the first maxSeconds of the
// source audio, for the music-detector sidecar. The classifier resamples to mono
// 16 kHz internally, so this keeps the upload small without losing anything it
// uses. maxSeconds <= 0 extracts the whole track.
func ExtractAudioClip(srcPath, outputDir string, maxSeconds int) (string, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return "", fmt.Errorf("create output dir: %w", err)
	}
	out := filepath.Join(outputDir, "music_probe.wav")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	args := []string{"-hide_banner", "-loglevel", "error", "-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000"}
	if maxSeconds > 0 {
		args = append(args, "-t", strconv.Itoa(maxSeconds))
	}
	args = append(args, "-f", "wav", out)

	if err := FFmpegCommand(ctx, args...).Run(); err != nil {
		os.Remove(out)
		return "", fmt.Errorf("extract audio clip: %w", err)
	}
	return out, nil
}
