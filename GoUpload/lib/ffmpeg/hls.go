package ffmpeg

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"goupload/lib/env"
)

type QualityTier struct {
	Name      string
	Label     string
	Width     int
	Height    int
	CRF       string
	MaxRate   string
	BufSize   string
	Bandwidth int
	AudioBR   string
}

var allTiers = []QualityTier{
	{Name: "360p", Label: "360p", Width: 640, Height: 360, CRF: "28", MaxRate: "1M", BufSize: "2M", Bandwidth: 800000, AudioBR: "96k"},
	{Name: "480p", Label: "480p", Width: 854, Height: 480, CRF: "26", MaxRate: "1.5M", BufSize: "3M", Bandwidth: 1200000, AudioBR: "128k"},
	{Name: "720p", Label: "720p HD", Width: 1280, Height: 720, CRF: "23", MaxRate: "3M", BufSize: "6M", Bandwidth: 2500000, AudioBR: "128k"},
	{Name: "1080p", Label: "1080p Full HD", Width: 1920, Height: 1080, CRF: "20", MaxRate: "5M", BufSize: "10M", Bandwidth: 5000000, AudioBR: "192k"},
	{Name: "1440p", Label: "1440p 2K", Width: 2560, Height: 1440, CRF: "18", MaxRate: "10M", BufSize: "20M", Bandwidth: 10000000, AudioBR: "192k"},
	{Name: "2160p", Label: "2160p 4K", Width: 3840, Height: 2160, CRF: "16", MaxRate: "20M", BufSize: "40M", Bandwidth: 20000000, AudioBR: "256k"},
	{Name: "4320p", Label: "4320p 8K", Width: 7680, Height: 4320, CRF: "14", MaxRate: "40M", BufSize: "80M", Bandwidth: 40000000, AudioBR: "320k"},
}

type HLSResult struct {
	M3U8Path     string
	SegmentFiles []string
	UsedGPU      bool
	Width        int
	Height       int
	Bandwidth    int
	TierName     string
}

type HLSAllResult struct {
	MasterPath string
	Tiers      []*HLSResult
}

type HLSOptions struct {
	Quality     string
	SegmentTime int
}

func ConvertToHLS(inputPath, outputDir string, opts HLSOptions) (*HLSResult, error) {
	if opts.Quality == "" {
		opts.Quality = "medium"
	}
	tier := allTiers[2]
	probe, err := ProbeVideo(inputPath)
	if err != nil {
		return nil, fmt.Errorf("probe source: %w", err)
	}
	hasAudio := strings.TrimSpace(probe.AudioCodec) != ""
	return convertTier(inputPath, outputDir, opts, tier, checkGPU(), hasAudio)
}

func selectTiers(srcWidth, srcHeight int) []QualityTier {
	srcShort := srcHeight
	if srcWidth < srcHeight {
		srcShort = srcWidth
	}

	var selected []QualityTier
	for _, t := range allTiers {
		tierShort := t.Height
		if t.Width < t.Height {
			tierShort = t.Width
		}
		if tierShort < srcShort {
			selected = append(selected, t)
		}
	}

	originalTier := QualityTier{
		Name:    "source",
		Label:   fmt.Sprintf("%dp Original", srcHeight),
		Width:   srcWidth,
		Height:  srcHeight,
		CRF:     "16",
		MaxRate: "50M",
		BufSize: "100M",
		AudioBR: "256k",
	}

	for _, t := range allTiers {
		if t.Height >= srcHeight {
			originalTier.CRF = t.CRF
			originalTier.MaxRate = t.MaxRate
			originalTier.BufSize = t.BufSize
			originalTier.Bandwidth = t.Bandwidth
			originalTier.AudioBR = t.AudioBR
			break
		}
	}
	if originalTier.Bandwidth == 0 {
		last := allTiers[len(allTiers)-1]
		originalTier.CRF = last.CRF
		originalTier.MaxRate = last.MaxRate
		originalTier.BufSize = last.BufSize
		originalTier.Bandwidth = last.Bandwidth
		originalTier.AudioBR = last.AudioBR
	}
	selected = append(selected, originalTier)

	if len(selected) <= 1 {
		return selected
	}
	if len(selected) > 5 {
		step := float64(len(selected)-1) / 4.0
		var pruned []QualityTier
		pruned = append(pruned, selected[0])
		for i := 1; i < 4; i++ {
			idx := int(float64(i)*step + 0.5)
			if idx >= len(selected)-1 {
				idx = len(selected) - 2
			}
			pruned = append(pruned, selected[idx])
		}
		pruned = append(pruned, selected[len(selected)-1])
		selected = pruned
	}

	return selected
}

func ConvertToHLSAllQualities(inputPath, outputDir string, opts HLSOptions) (*HLSAllResult, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}
	if opts.SegmentTime <= 0 {
		opts.SegmentTime = 10
	}

	st, err := os.Stat(inputPath)
	if err != nil {
		return nil, fmt.Errorf("stat source: %w", err)
	}
	inputSz := uint64(st.Size())

	probe, err := ProbeVideo(inputPath)
	if err != nil {
		return nil, fmt.Errorf("probe source: %w", err)
	}

	minFreeWhole := uint64(5 << 30)
	if est := inputSz * 3; est > minFreeWhole {
		minFreeWhole = est
	}
	if err := RequireMinFreeSpace(outputDir, minFreeWhole); err != nil {
		return nil, err
	}

	tiers := selectTiers(probe.Width, probe.Height)
	if len(tiers) == 0 {
		return nil, fmt.Errorf("no quality tiers for %dx%d", probe.Width, probe.Height)
	}

	hasAudio := strings.TrimSpace(probe.AudioCodec) != ""
	hasGPU := checkGPU()
	var results []*HLSResult

	for i, tier := range tiers {
		log.Printf("[hls] starting tier %d/%d: %s (%dx%d)", i+1, len(tiers), tier.Name, tier.Width, tier.Height)
		tierStart := time.Now()
		dir := filepath.Join(outputDir, tier.Name)
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		minFreeTier := uint64(2 << 30)
		if est := inputSz * 2; est > minFreeTier {
			minFreeTier = est
		}
		if err := RequireMinFreeSpace(dir, minFreeTier); err != nil {
			return nil, fmt.Errorf("hls %s: %w", tier.Name, err)
		}
		r, err := convertTier(inputPath, dir, opts, tier, hasGPU, hasAudio)
		if err != nil {
			return nil, fmt.Errorf("hls %s: %w", tier.Name, err)
		}
		r.TierName = tier.Name
		results = append(results, r)
		log.Printf("[hls] finished tier %d/%d: %s (%d segments, took %s)", i+1, len(tiers), tier.Name, len(r.SegmentFiles), time.Since(tierStart).Round(time.Second))
	}

	var masterLines []string
	masterLines = append(masterLines, "#EXTM3U", "#EXT-X-VERSION:3")
	for _, r := range results {
		masterLines = append(masterLines,
			fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d", r.Bandwidth, r.Width, r.Height),
			r.TierName+"/playlist.m3u8",
		)
	}
	masterLines = append(masterLines, "")

	masterPath := filepath.Join(outputDir, "master.m3u8")
	if err := os.WriteFile(masterPath, []byte(strings.Join(masterLines, "\n")), 0644); err != nil {
		return nil, fmt.Errorf("write master: %w", err)
	}

	return &HLSAllResult{MasterPath: masterPath, Tiers: results}, nil
}

func convertTier(inputPath, outputDir string, opts HLSOptions, tier QualityTier, tryGPU bool, hasAudio bool) (*HLSResult, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, err
	}
	if opts.SegmentTime <= 0 {
		opts.SegmentTime = 10
	}

	m3u8Path := filepath.Join(outputDir, "playlist.m3u8")
	segmentPattern := filepath.Join(outputDir, "segment_%03d.ts")

	if tryGPU {
		r, err := runTierConversionWithRetries(inputPath, m3u8Path, segmentPattern, opts, tier, true, hasAudio)
		if err == nil {
			return r, nil
		}
		log.Printf("[hls] GPU encode failed for %s, falling back to CPU: %v", tier.Name, err)
	}

	return runTierConversionWithRetries(inputPath, m3u8Path, segmentPattern, opts, tier, false, hasAudio)
}

func isRetriableTranscodeError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "short write") ||
		strings.Contains(s, "cannot allocate memory") ||
		strings.Contains(s, "resource temporarily unavailable") ||
		strings.Contains(s, "i/o error")
}

func runTierConversionWithRetries(inputPath, m3u8Path, segmentPattern string, opts HLSOptions, tier QualityTier, useGPU bool, hasAudio bool) (*HLSResult, error) {
	const maxAttempts = 3
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(45 * time.Second)
		}
		r, err := runTierConversion(inputPath, m3u8Path, segmentPattern, opts, tier, useGPU, hasAudio)
		if err == nil {
			return r, nil
		}
		lastErr = err
		if !isRetriableTranscodeError(err) {
			return nil, err
		}
	}
	return nil, lastErr
}

func ffmpegPathArg(p string) string {
	return filepath.ToSlash(filepath.Clean(p))
}

func ffmpegStderrTail(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || len(s) <= max {
		return s
	}
	return "…" + s[len(s)-max:]
}

// minSalvageableSegments: if FFmpeg dies but already wrote at least this many
// segments, accept the partial output instead of failing the whole tier.
const minSalvageableSegments = 10

func runTierConversion(inputPath, m3u8Path, segmentPattern string, opts HLSOptions, tier QualityTier, useGPU bool, hasAudio bool) (*HLSResult, error) {
	inputPath = ffmpegPathArg(inputPath)
	m3u8Path = ffmpegPathArg(m3u8Path)
	segmentPattern = ffmpegPathArg(segmentPattern)

	args := buildTierArgs(inputPath, m3u8Path, segmentPattern, opts, tier, useGPU, hasAudio)

	h := env.GetInt64("GOUpload_HLS_FFMPEG_TIMEOUT_HOURS", 6)
	if h < 1 {
		h = 1
	}
	if h > 72 {
		h = 72
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(h)*time.Hour)
	defer cancel()

	cmd := FFmpegCommand(ctx, args...)
	var stderr limitedWriter
	stderr.max = 2 << 20
	cmd.Stderr = &stderr

	ffmpegErr := runFFmpegWithOptionalMemGovernor(cmd)

	// Check what FFmpeg actually produced before deciding to fail.
	m3u8Exists := false
	if _, statErr := os.Stat(m3u8Path); statErr == nil {
		m3u8Exists = true
	}
	segments, segErr := findSegments(filepath.Dir(m3u8Path))
	segCount := 0
	if segErr == nil {
		segCount = len(segments)
	}

	if ffmpegErr != nil {
		if m3u8Exists && segCount >= minSalvageableSegments {
			// FFmpeg died (often corrupt input near end-of-file) but wrote enough
			// usable output. Salvage what we have — the m3u8 references written segments
			// and HLS players handle a truncated stream gracefully.
			log.Printf("[ffmpeg] salvaging partial output: %d segments written despite error: %v", segCount, ffmpegErr)
		} else {
			return nil, fmt.Errorf("ffmpeg: %w, stderr: %s", ffmpegErr, ffmpegStderrTail(stderr.String(), 6000))
		}
	} else if !m3u8Exists {
		return nil, fmt.Errorf("m3u8 not created")
	}

	return &HLSResult{
		M3U8Path:     m3u8Path,
		SegmentFiles: segments,
		UsedGPU:      useGPU,
		Width:        tier.Width,
		Height:       tier.Height,
		Bandwidth:    tier.Bandwidth,
		TierName:     tier.Name,
	}, nil
}

func findSegments(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var segments []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "segment_") && strings.HasSuffix(e.Name(), ".ts") {
			segments = append(segments, filepath.Join(dir, e.Name()))
		}
	}

	return segments, nil
}

func checkGPU() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := FFmpegCommand(ctx, "-nostdin", "-hide_banner", "-encoders")
	var out limitedWriter
	out.max = 512 << 10
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return false
	}
	return strings.Contains(out.String(), "h264_nvenc")
}

func CleanupHLS(result *HLSResult) {
	if result == nil {
		return
	}
	_ = os.Remove(result.M3U8Path)
	for _, seg := range result.SegmentFiles {
		_ = os.Remove(seg)
	}
}
