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

// ExtractAudioRange writes a short MP3 of [startSec, startSec+durSec) from the
// source for AcoustID. The clip is intentionally small: AcoustID only uses the
// fingerprint of the first ~120s, and GoUpload never uploads the whole file.
func ExtractAudioRange(srcPath, outputDir string, startSec, durSec float64) (string, error) {
	if durSec <= 0 {
		return "", fmt.Errorf("extract audio range: duration must be > 0")
	}
	if startSec < 0 {
		startSec = 0
	}
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return "", fmt.Errorf("create output dir: %w", err)
	}
	out := filepath.Join(outputDir, "clip.mp3")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// -ss before -i for a fast seek; fine for fingerprinting (not archival).
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-ss", strconv.FormatFloat(startSec, 'f', 3, 64),
		"-i", srcPath,
		"-t", strconv.FormatFloat(durSec, 'f', 3, 64),
		"-vn",
		"-ac", "2",
		"-ar", "44100",
		"-b:a", "128k",
		"-f", "mp3",
		out,
	}
	if err := FFmpegCommand(ctx, args...).Run(); err != nil {
		os.Remove(out)
		return "", fmt.Errorf("extract audio range: %w", err)
	}
	return out, nil
}
