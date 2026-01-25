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

type HLSResult struct {
	M3U8Path     string
	SegmentFiles []string
	UsedGPU      bool
	Width        int
	Height       int
	Bandwidth    int
}

type HLSAllResult struct {
	MasterPath string
	Low        *HLSResult
	Medium     *HLSResult
	High       *HLSResult
}

type HLSOptions struct {
	Quality     string
	SegmentTime int
}

func ConvertToHLS(inputPath, outputDir string, opts HLSOptions) (*HLSResult, error) {
	if opts.Quality == "" {
		opts.Quality = "medium"
	}
	return convertToHLSOne(inputPath, outputDir, opts, checkGPU())
}

func ConvertToHLSAllQualities(inputPath, outputDir string, opts HLSOptions) (*HLSAllResult, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}
	if opts.SegmentTime <= 0 {
		opts.SegmentTime = 10
	}

	hasGPU := checkGPU()

	run := func(q string) (*HLSResult, error) {
		dir := filepath.Join(outputDir, q)
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		o := opts
		o.Quality = q
		return convertToHLSOne(inputPath, dir, o, hasGPU)
	}

	low, err := run("low")
	if err != nil {
		return nil, fmt.Errorf("hls low: %w", err)
	}
	medium, err := run("medium")
	if err != nil {
		return nil, fmt.Errorf("hls medium: %w", err)
	}
	high, err := run("high")
	if err != nil {
		return nil, fmt.Errorf("hls high: %w", err)
	}

	masterPath := filepath.Join(outputDir, "master.m3u8")
	content := fmt.Sprintf("#EXTM3U\n#EXT-X-VERSION:3\n"+
		"#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d\nlow/playlist.m3u8\n"+
		"#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d\nmedium/playlist.m3u8\n"+
		"#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d\nhigh/playlist.m3u8\n",
		low.Bandwidth, low.Width, low.Height,
		medium.Bandwidth, medium.Width, medium.Height,
		high.Bandwidth, high.Width, high.Height,
	)
	if err := os.WriteFile(masterPath, []byte(content), 0644); err != nil {
		return nil, fmt.Errorf("write master: %w", err)
	}

	return &HLSAllResult{MasterPath: masterPath, Low: low, Medium: medium, High: high}, nil
}

func convertToHLSOne(inputPath, outputDir string, opts HLSOptions, tryGPU bool) (*HLSResult, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, err
	}
	if opts.SegmentTime <= 0 {
		opts.SegmentTime = 10
	}

	m3u8Path := filepath.Join(outputDir, "playlist.m3u8")
	segmentPattern := filepath.Join(outputDir, "segment_%03d.ts")

	if tryGPU {
		r, err := runHLSConversion(inputPath, m3u8Path, segmentPattern, opts, true)
		if err == nil {
			return r, nil
		}
	}

	return runHLSConversion(inputPath, m3u8Path, segmentPattern, opts, false)
}

func runHLSConversion(inputPath, m3u8Path, segmentPattern string, opts HLSOptions, useGPU bool) (*HLSResult, error) {
	cpuThreads := runtime.NumCPU()
	if cpuThreads > 8 {
		cpuThreads = 8
	}

	var args []string

	if useGPU {
		args = append(args, "-hwaccel", "cuda", "-hwaccel_output_format", "cuda")
	}

	crf, maxrate, bufsize, w, h, bw := getQualitySettings(opts.Quality)
	// Scale to target width, auto-calculate height to preserve aspect ratio
	// -2 ensures height is divisible by 2 (required for h264)
	// Only downscale, never upscale: min(target, original)
	scale := fmt.Sprintf("scale='min(%d,iw)':-2", w)

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
		"-crf", crf,
		"-maxrate", maxrate,
		"-bufsize", bufsize,
		"-c:a", "aac",
		"-b:a", "128k",
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
		Width:        w,
		Height:       h,
		Bandwidth:    bw,
	}, nil
}

func getQualitySettings(quality string) (crf, maxrate, bufsize string, width, height, bandwidth int) {
	switch quality {
	case "low":
		return "28", "1M", "2M", 640, 360, 800000
	case "high":
		return "20", "5M", "10M", 1920, 1080, 5000000
	default:
		return "23", "3M", "6M", 1280, 720, 2000000
	}
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
