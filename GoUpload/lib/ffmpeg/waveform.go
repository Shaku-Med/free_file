package ffmpeg

import (
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const (
	WaveformWidth  = 800
	WaveformHeight = 48
	pcmSampleRate  = 200
	minPCMBytes    = WaveformWidth * 2
)

func ExtractWaveform(videoPath, outputDir string) (outPath string, err error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return "", fmt.Errorf("create output dir: %w", err)
	}

	outPath = filepath.Join(outputDir, "waveform.png")

	peaks, err := extractAudioPeaks(videoPath, outputDir)
	if err != nil {
		return "", err
	}

	img := drawFilledWaveform(peaks)

	f, err := os.Create(outPath)
	if err != nil {
		return "", fmt.Errorf("create waveform file: %w", err)
	}
	defer f.Close()

	if err := png.Encode(f, img); err != nil {
		_ = os.Remove(outPath)
		return "", fmt.Errorf("encode waveform png: %w", err)
	}

	return outPath, nil
}

func extractAudioPeaks(videoPath, tmpDir string) ([]float64, error) {
	pcmPath := filepath.Join(tmpDir, "waveform_tmp.pcm")
	defer os.Remove(pcmPath)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	args := []string{
		"-nostdin",
		"-fflags", "+genpts+igndts+discardcorrupt",
		"-err_detect", "ignore_err",
		"-i", ffmpegPathArg(videoPath),
		"-vn",
		"-ac", "1",
		"-ar", fmt.Sprintf("%d", pcmSampleRate),
		"-f", "s16le",
		"-acodec", "pcm_s16le",
		"-y",
		ffmpegPathArg(pcmPath),
	}

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	var stderr limitedWriter
	stderr.max = 1 << 20
	cmd.Stderr = &stderr

	ffmpegErr := cmd.Run()

	raw, readErr := os.ReadFile(pcmPath)
	if readErr != nil && ffmpegErr != nil {
		return nil, fmt.Errorf("ffmpeg audio extract: %w, stderr: %s", ffmpegErr, stderr.String())
	}
	if len(raw) < minPCMBytes {
		if ffmpegErr != nil {
			return nil, fmt.Errorf("ffmpeg audio extract (too little data: %d bytes): %w", len(raw), ffmpegErr)
		}
		return nil, fmt.Errorf("audio too short (%d bytes)", len(raw))
	}

	totalSamples := len(raw) / 2
	samplesPerBin := totalSamples / WaveformWidth
	if samplesPerBin < 1 {
		samplesPerBin = 1
	}

	peaks := make([]float64, WaveformWidth)
	var maxPeak float64

	for i := 0; i < WaveformWidth; i++ {
		start := i * samplesPerBin
		end := start + samplesPerBin
		if end > totalSamples {
			end = totalSamples
		}
		if start >= totalSamples {
			break
		}
		var rms float64
		count := 0
		for j := start; j < end; j++ {
			s := int16(binary.LittleEndian.Uint16(raw[j*2 : j*2+2]))
			v := float64(s) / 32768.0
			rms += v * v
			count++
		}
		if count > 0 {
			rms = math.Sqrt(rms / float64(count))
		}
		peaks[i] = rms
		if rms > maxPeak {
			maxPeak = rms
		}
	}

	if maxPeak > 0 {
		for i := range peaks {
			peaks[i] /= maxPeak
		}
	}

	smoothed := make([]float64, len(peaks))
	const radius = 2
	for i := range peaks {
		sum := 0.0
		n := 0
		for k := i - radius; k <= i+radius; k++ {
			if k >= 0 && k < len(peaks) {
				sum += peaks[k]
				n++
			}
		}
		smoothed[i] = sum / float64(n)
	}

	return smoothed, nil
}

// drawFilledWaveform draws a YouTube-style filled waveform:
// amplitude grows upward from the bottom, filled solid underneath.
func drawFilledWaveform(peaks []float64) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, WaveformWidth, WaveformHeight))

	maxH := float64(WaveformHeight - 1)
	baseline := WaveformHeight - 1
	white := color.NRGBA{R: 255, G: 255, B: 255, A: 255}

	for x := 0; x < WaveformWidth && x < len(peaks); x++ {
		h := peaks[x] * maxH
		if h < 1 {
			h = 1
		}
		topY := baseline - int(math.Round(h))
		if topY < 0 {
			topY = 0
		}

		for y := topY; y <= baseline; y++ {
			img.SetNRGBA(x, y, white)
		}
	}

	return img
}
