package ffmpeg

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"time"
)

// Waveform output is now JSON, not a PNG. The client renders the bars on
// a <canvas> using these normalized peaks — same idea as YouTube /
// SoundCloud — so we can re-style (color, height, bar width) without
// regenerating files server-side.

const (
	// WaveformSamples is the number of normalized amplitude buckets stored
	// in the JSON. 800 is enough resolution for the typical seek-bar width
	// across desktop + mobile; the client decimates if it has fewer pixels.
	WaveformSamples = 800
	// pcmSampleRate is the PCM sample rate ffmpeg downmixes to before we
	// bucket. Low because we only need amplitude envelope, not playable audio.
	pcmSampleRate = 200
	minPCMBytes   = WaveformSamples * 2
)

// WaveformFile is what we serialise. Version makes future format changes
// safe to roll out without breaking older clients.
type WaveformFile struct {
	Version    int       `json:"version"`
	Samples    int       `json:"samples"`
	SampleRate int       `json:"sample_rate"`
	HasAudio   bool      `json:"has_audio"`
	Peaks      []float64 `json:"peaks"`
}

// WaveformResult is what worker code consumes — the JSON path plus the
// flags it needs to drive UI (disable the volume button on silent videos,
// flag obviously-corrupt-audio cases for logging, etc.).
type WaveformResult struct {
	Path     string
	HasAudio bool
}

// hasAudioRMSThreshold is the minimum normalized RMS amplitude we count as
// "real audio". Picked empirically — line-level hiss on a phone recording
// sits around 0.003, an intentionally silent track is < 0.001. 0.01 is
// conservative enough to mark dead-silent footage as no-audio while still
// catching whispered dialogue.
const hasAudioRMSThreshold = 0.01

// ExtractWaveform pulls a mono PCM stream from the video, buckets it into
// `WaveformSamples` normalized RMS amplitudes (0..1), and writes a small
// JSON file the client can render with a few lines of canvas code.
//
// Always writes a file. If audio extraction fails (silent video, no audio
// stream, corrupt input, etc.) we still emit a flat-zeros peaks array so
// downstream consumers can rely on the file existing — the player just
// renders a hairline instead of branching on "has waveform".
//
// Returns a WaveformResult with .HasAudio set to true when at least one
// bucket's RMS amplitude clears `hasAudioRMSThreshold`. The Go worker
// pipes that boolean into webhook metadata so the React player can grey
// out the volume button on silent videos.
func ExtractWaveform(videoPath, outputDir string) (*WaveformResult, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}
	outPath := filepath.Join(outputDir, "waveform.json")

	peaks, perr := extractAudioPeaks(videoPath, outputDir)
	hasAudio := false
	if perr != nil {
		// Soft-fail: write a zeroed peaks array so the JSON file always
		// exists. Caller can still inspect the returned error if it cares.
		peaks = make([]float64, WaveformSamples)
	} else {
		// Decide has_audio BEFORE rounding — rounding to 4dp can flatten
		// tiny-but-real amplitudes near the threshold.
		for _, v := range peaks {
			if v >= hasAudioRMSThreshold {
				hasAudio = true
				break
			}
		}
	}

	// Round to 4 decimals — keeps the file tiny (~6 KB) without losing
	// any visual fidelity at the resolutions we render.
	for i, v := range peaks {
		peaks[i] = math.Round(v*10000) / 10000
	}

	doc := WaveformFile{
		Version:    1,
		Samples:    len(peaks),
		SampleRate: pcmSampleRate,
		HasAudio:   hasAudio,
		Peaks:      peaks,
	}
	buf, merr := json.Marshal(doc)
	if merr != nil {
		return nil, fmt.Errorf("marshal waveform: %w", merr)
	}
	if werr := os.WriteFile(outPath, buf, 0644); werr != nil {
		return nil, fmt.Errorf("write waveform json: %w", werr)
	}

	// Surface the extraction error to the caller (for logging) but the
	// file is on disk either way.
	return &WaveformResult{Path: outPath, HasAudio: hasAudio}, perr
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

	cmd := FFmpegCommand(ctx, args...)
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
	samplesPerBin := totalSamples / WaveformSamples
	if samplesPerBin < 1 {
		samplesPerBin = 1
	}

	peaks := make([]float64, WaveformSamples)
	var maxPeak float64

	for i := 0; i < WaveformSamples; i++ {
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

	// Light smoothing kills single-sample spikes so the rendered bars look
	// more like a YouTube waveform than a stock chart.
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
