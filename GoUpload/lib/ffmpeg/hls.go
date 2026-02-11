package ffmpeg

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
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
	return convertTier(inputPath, outputDir, opts, tier, checkGPU())
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

	probe, err := ProbeVideo(inputPath)
	if err != nil {
		return nil, fmt.Errorf("probe source: %w", err)
	}

	tiers := selectTiers(probe.Width, probe.Height)
	if len(tiers) == 0 {
		return nil, fmt.Errorf("no quality tiers for %dx%d", probe.Width, probe.Height)
	}

	hasGPU := checkGPU()
	var results []*HLSResult

	for _, tier := range tiers {
		dir := filepath.Join(outputDir, tier.Name)
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		r, err := convertTier(inputPath, dir, opts, tier, hasGPU)
		if err != nil {
			return nil, fmt.Errorf("hls %s: %w", tier.Name, err)
		}
		r.TierName = tier.Name
		results = append(results, r)
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

func convertTier(inputPath, outputDir string, opts HLSOptions, tier QualityTier, tryGPU bool) (*HLSResult, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, err
	}
	if opts.SegmentTime <= 0 {
		opts.SegmentTime = 10
	}

	m3u8Path := filepath.Join(outputDir, "playlist.m3u8")
	segmentPattern := filepath.Join(outputDir, "segment_%03d.ts")

	if tryGPU {
		r, err := runTierConversion(inputPath, m3u8Path, segmentPattern, opts, tier, true)
		if err == nil {
			return r, nil
		}
	}

	return runTierConversion(inputPath, m3u8Path, segmentPattern, opts, tier, false)
}

func runTierConversion(inputPath, m3u8Path, segmentPattern string, opts HLSOptions, tier QualityTier, useGPU bool) (*HLSResult, error) {
	cpuThreads := runtime.NumCPU()
	if cpuThreads > 8 {
		cpuThreads = 8
	}

	var args []string

	if useGPU {
		args = append(args, "-hwaccel", "cuda", "-hwaccel_output_format", "cuda")
	}

	scale := fmt.Sprintf("scale='min(%d,iw)':-2", tier.Width)

	args = append(args,
		"-fflags", "+genpts+igndts",
		"-analyzeduration", "100M",
		"-probesize", "100M",
		"-err_detect", "ignore_err",
		"-i", inputPath,
		"-map", "0:v:0?",
		"-map", "0:a:0?",
		"-vf", scale,
		"-threads", fmt.Sprintf("%d", cpuThreads),
	)

	if useGPU {
		args = append(args,
			"-c:v", "h264_nvenc",
			"-preset", "p1",
			"-tune", "zerolatency",
		)
	} else {
		args = append(args,
			"-c:v", "libx264",
			"-preset", "fast",
			"-tune", "fastdecode",
		)
	}

	args = append(args,
		"-crf", tier.CRF,
		"-maxrate", tier.MaxRate,
		"-bufsize", tier.BufSize,
		"-c:a", "aac",
		"-b:a", tier.AudioBR,
		"-ac", "2",
		"-ar", "48000",
		"-max_muxing_queue_size", "2048",
		"-hls_time", fmt.Sprintf("%d", opts.SegmentTime),
		"-hls_list_size", "0",
		"-hls_segment_filename", segmentPattern,
		"-hls_flags", "independent_segments",
		"-hls_allow_cache", "0",
		"-hls_start_number_source", "0",
		"-f", "hls",
		"-y",
		m3u8Path,
	)

	cmd := exec.Command("ffmpeg", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg: %w, stderr: %s", err, stderr.String())
	}

	if _, err := os.Stat(m3u8Path); os.IsNotExist(err) {
		return nil, fmt.Errorf("m3u8 not created")
	}

	segments, err := findSegments(filepath.Dir(m3u8Path))
	if err != nil {
		return nil, fmt.Errorf("find segments: %w", err)
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
	cmd := exec.Command("ffmpeg", "-hide_banner", "-encoders")
	var out bytes.Buffer
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
