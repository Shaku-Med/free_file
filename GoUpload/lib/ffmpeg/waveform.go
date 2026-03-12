package ffmpeg

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const (
	WaveformWidth  = 800
	WaveformHeight = 32
)

// ExtractWaveform generates a horizontal waveform image (white wave on dark background)
// for the audio track of the video. Writes waveform.png to outputDir.
// Safe to call for videos without audio; will produce a flat line or skip.
func ExtractWaveform(videoPath, outputDir string) (outPath string, err error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return "", fmt.Errorf("create output dir: %w", err)
	}

	outPath = filepath.Join(outputDir, "waveform.png")

	filter := fmt.Sprintf("[0:a]showwavespic=s=%dx%d:colors=0xffffff:scale=lin[v]", WaveformWidth, WaveformHeight)

	args := []string{
		"-i", videoPath,
		"-filter_complex", filter,
		"-map", "[v]",
		"-frames:v", "1",
		"-y",
		outPath,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	var stderr limitedWriter
	stderr.max = 1 << 20
	cmd.Stderr = &stderr
	if runErr := cmd.Run(); runErr != nil {
		_ = os.Remove(outPath)
		return "", fmt.Errorf("ffmpeg waveform: %w, stderr: %s", runErr, stderr.String())
	}

	return outPath, nil
}
