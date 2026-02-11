package ffmpeg

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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

	cmd := exec.Command("ffmpeg", args...)
	if out, runErr := cmd.CombinedOutput(); runErr != nil {
		_ = os.Remove(outPath)
		return "", fmt.Errorf("ffmpeg waveform: %w, output: %s", runErr, string(out))
	}

	return outPath, nil
}
