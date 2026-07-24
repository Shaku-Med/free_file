package ffmpeg

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
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
	// IsReel switches to the compact reel ladder (capped at 720p, tighter CRF).
	IsReel bool
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
	// Single-tier path keeps audio muxed: there are no sibling renditions to
	// share a separate audio track with.
	return convertTier(inputPath, outputDir, opts, tier, checkGPU(), hasAudio, false)
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

// selectReelTiers builds the compact ladder for reels: phone-first, so the
// short side is capped at 720 (no 1080p/1440p/4K), CRF is a notch tighter than
// the equivalent full tier, and at most two renditions are produced. Width here
// is the target short-side pixel count, so it scales correctly for portrait
// clips (720 → 720x1280) as well as the occasional landscape reel.
func selectReelTiers(srcWidth, srcHeight int) []QualityTier {
	short := srcHeight
	if srcWidth < srcHeight {
		short = srcWidth
	}
	if short <= 0 {
		short = 720
	}

	mk := func(w int, crf, maxrate, buf string, bw int) QualityTier {
		return QualityTier{
			Name:      fmt.Sprintf("%dp", w),
			Label:     fmt.Sprintf("%dp", w),
			Width:     w,
			Height:    w, // placeholder; real dims recomputed from source aspect
			CRF:       crf,
			MaxRate:   maxrate,
			BufSize:   buf,
			Bandwidth: bw,
		}
	}

	// Cap at 720, never upscale past the source.
	top := short
	if top > 720 {
		top = 720
	}

	if top <= 480 {
		return []QualityTier{mk(top, "27", "1.2M", "2.4M", 900000)}
	}
	return []QualityTier{
		mk(480, "27", "1.2M", "2.4M", 900000),
		mk(top, "25", "2.2M", "4.4M", 1800000),
	}
}

// scaledDims mirrors the ffmpeg `scale='min(width,iw)':-2` filter so the master
// playlist advertises the resolution ffmpeg actually produced (aspect-correct,
// no upscale, even dimensions) instead of the tier's nominal box.
func scaledDims(tierWidth, srcW, srcH int) (int, int) {
	if srcW <= 0 || srcH <= 0 {
		return tierWidth, 0
	}
	w := tierWidth
	if w > srcW {
		w = srcW
	}
	h := (w*srcH + srcW/2) / srcW
	if w%2 != 0 {
		w++
	}
	if h%2 != 0 {
		h++
	}
	return w, h
}

// audioRung is one shared audio track: a group id (also its folder name) and a
// bitrate. A handful of rungs are shared across resolution bands so audio
// quality tracks video quality without storing a separate copy per rendition.
type audioRung struct {
	id      string
	bitrate string
}

// audioRungForShort maps a rendition's short side to its audio rung. Low video
// pulls low audio; high video pulls high audio. The player switches audio group
// automatically when ABR crosses a band boundary.
func audioRungForShort(short int) audioRung {
	switch {
	case short <= 480:
		return audioRung{"low", "64k"}
	case short <= 1080:
		return audioRung{"mid", "128k"}
	default:
		return audioRung{"high", "192k"}
	}
}

// capAudioBitrate clamps a target like "128k" to the source bitrate so a
// low-bitrate upload is never upsampled, with a 32k floor.
func capAudioBitrate(target string, srcBitrate int) string {
	kbps := audioBitrateBps(target) / 1000
	if srcBitrate >= 1000 { // bits/sec from the probe
		if srcK := srcBitrate / 1000; srcK < kbps {
			kbps = srcK
		}
	}
	if kbps < 32 {
		kbps = 32
	}
	return fmt.Sprintf("%dk", kbps)
}

// audioBitrateBps parses "128k"/"1.5M" into bits/sec for the master BANDWIDTH.
func audioBitrateBps(br string) int {
	s := strings.ToLower(strings.TrimSpace(br))
	mult := 1
	switch {
	case strings.HasSuffix(s, "k"):
		mult, s = 1000, strings.TrimSuffix(s, "k")
	case strings.HasSuffix(s, "m"):
		mult, s = 1000000, strings.TrimSuffix(s, "m")
	}
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 128000
	}
	return n * mult
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

	var tiers []QualityTier
	if opts.IsReel {
		tiers = selectReelTiers(probe.Width, probe.Height)
	} else {
		tiers = selectTiers(probe.Width, probe.Height)
	}
	if len(tiers) == 0 {
		return nil, fmt.Errorf("no quality tiers for %dx%d", probe.Width, probe.Height)
	}

	hasAudio := strings.TrimSpace(probe.AudioCodec) != ""
	hasGPU := checkGPU()
	var results []*HLSResult

	for i, tier := range tiers {
		log.Printf("[hls] starting tier %d/%d: %s (target width %d)", i+1, len(tiers), tier.Name, tier.Width)
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
		// Video renditions are always encoded without audio here; the shared
		// audio track (below) carries it for every quality.
		r, err := convertTier(inputPath, dir, opts, tier, hasGPU, hasAudio, true)
		if err != nil {
			return nil, fmt.Errorf("hls %s: %w", tier.Name, err)
		}
		r.TierName = tier.Name
		r.Width, r.Height = scaledDims(tier.Width, probe.Width, probe.Height)
		results = append(results, r)
		log.Printf("[hls] finished tier %d/%d: %s %dx%d (%d segments, took %s)", i+1, len(tiers), tier.Name, r.Width, r.Height, len(r.SegmentFiles), time.Since(tierStart).Round(time.Second))
	}

	// Assign each variant an audio rung by its (actual) short side, then encode
	// each DISTINCT rung once. Audio quality tracks video quality while a rung is
	// still shared by every rendition in its band, so we store a couple of audio
	// copies instead of one per tier.
	variantRung := make([]audioRung, len(results))
	var distinct []audioRung
	seen := map[string]bool{}
	rungBW := map[string]int{}
	if hasAudio {
		for i, r := range results {
			short := r.Height
			if r.Width < r.Height {
				short = r.Width
			}
			rung := audioRungForShort(short)
			variantRung[i] = rung
			if !seen[rung.id] {
				seen[rung.id] = true
				distinct = append(distinct, rung)
			}
		}
		for _, rung := range distinct {
			br := capAudioBitrate(rung.bitrate, probe.AudioBitrate)
			dir := filepath.Join(outputDir, "audio_"+rung.id)
			log.Printf("[hls] starting audio rung %q (%s)", rung.id, br)
			audioStart := time.Now()
			if err := convertAudioTrack(inputPath, dir, opts, br); err != nil {
				return nil, fmt.Errorf("hls audio %s: %w", rung.id, err)
			}
			rungBW[rung.id] = audioBitrateBps(br)
			log.Printf("[hls] finished audio rung %q (took %s)", rung.id, time.Since(audioStart).Round(time.Second))
		}
	}

	var masterLines []string
	masterLines = append(masterLines, "#EXTM3U", "#EXT-X-VERSION:4")
	for _, rung := range distinct {
		masterLines = append(masterLines,
			fmt.Sprintf(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud-%s",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio_%s/audio.m3u8"`, rung.id, rung.id),
		)
	}
	for i, r := range results {
		bw := r.Bandwidth
		inf := fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d", bw+rungBW[variantRung[i].id], r.Width, r.Height)
		if hasAudio {
			inf += fmt.Sprintf(`,AUDIO="aud-%s"`, variantRung[i].id)
		}
		masterLines = append(masterLines, inf, r.TierName+"/playlist.m3u8")
	}
	masterLines = append(masterLines, "")

	masterPath := filepath.Join(outputDir, "master.m3u8")
	if err := os.WriteFile(masterPath, []byte(strings.Join(masterLines, "\n")), 0644); err != nil {
		return nil, fmt.Errorf("write master: %w", err)
	}

	return &HLSAllResult{MasterPath: masterPath, Tiers: results}, nil
}

func convertTier(inputPath, outputDir string, opts HLSOptions, tier QualityTier, tryGPU bool, hasAudio bool, videoOnly bool) (*HLSResult, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, err
	}
	if opts.SegmentTime <= 0 {
		opts.SegmentTime = 10
	}

	m3u8Path := filepath.Join(outputDir, "playlist.m3u8")
	segmentPattern := filepath.Join(outputDir, "segment_%03d.ts")

	if tryGPU {
		r, err := runTierConversionWithRetries(inputPath, m3u8Path, segmentPattern, opts, tier, true, hasAudio, videoOnly)
		if err == nil {
			return r, nil
		}
		log.Printf("[hls] GPU encode failed for %s, falling back to CPU: %v", tier.Name, err)
	}

	return runTierConversionWithRetries(inputPath, m3u8Path, segmentPattern, opts, tier, false, hasAudio, videoOnly)
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

// envUint64 shared by the mem governor (linux) and the retry gates here.
func envUint64(key string, def uint64) uint64 {
	s := os.Getenv(key)
	if s == "" {
		return def
	}
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return def
	}
	return n
}

// memoryTight reports whether MemAvailable sits under the governor's resume
// threshold. Platforms without /proc/meminfo always report false.
func memoryTight() bool {
	avail, ok := MemAvailableMB()
	return ok && avail < envUint64("GOUpload_HLS_MEM_RESUME_MB", 700)
}

// waitForMemoryMB blocks (up to maxWait) until MemAvailable reaches minMB, so
// a retry starts on a box that actually recovered instead of a blind sleep.
// No-op where meminfo is unavailable.
func waitForMemoryMB(minMB uint64, maxWait time.Duration) {
	if minMB == 0 {
		return
	}
	deadline := time.Now().Add(maxWait)
	for {
		avail, ok := MemAvailableMB()
		if !ok || avail >= minMB || time.Now().After(deadline) {
			return
		}
		time.Sleep(5 * time.Second)
	}
}

// isMemoryPressureExit treats process-level deaths as retriable when the box
// is (or was just) short on memory: the OOM killer SIGKILLs ffmpeg outright,
// and severe pressure poisons encodes into arbitrary nonzero exits (the
// exit-254-at-91%-memory failures). Deterministic bad-input errors on a
// healthy box still fail fast through the normal path.
func isMemoryPressureExit(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	if strings.Contains(s, "signal: killed") || strings.Contains(s, "exit status 137") {
		return true
	}
	var exitErr *exec.ExitError
	return errors.As(err, &exitErr) && memoryTight()
}

// withMemoryRetries runs an encode up to maxAttempts times, waiting for memory
// to recover between tries and giving up immediately on deterministic (non
// memory-pressure) failures. Shared by the video tiers and the audio track.
func withMemoryRetries(label string, run func() error) error {
	const maxAttempts = 3
	pauseMB := envUint64("GOUpload_HLS_MEM_PAUSE_MB", 400)
	resumeMB := envUint64("GOUpload_HLS_MEM_RESUME_MB", 700)
	retryWait := time.Duration(env.GetInt64("GOUpload_HLS_MEM_RETRY_WAIT_SEC", 240)) * time.Second
	if retryWait < 30*time.Second {
		retryWait = 30 * time.Second
	}

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			// Let the box breathe: wait for memory to actually recover before
			// retrying, bounded so a permanently starved box still errors out.
			time.Sleep(10 * time.Second)
			waitForMemoryMB(resumeMB, retryWait)
		} else {
			// Don't start an encode that's doomed from the first frame.
			waitForMemoryMB(pauseMB, 90*time.Second)
		}
		err := run()
		if err == nil {
			return nil
		}
		lastErr = err
		if !isRetriableTranscodeError(err) && !isMemoryPressureExit(err) {
			return err
		}
		log.Printf("[hls] %s attempt %d/%d failed under pressure, will retry: %v", label, attempt+1, maxAttempts, err)
	}
	return lastErr
}

func runTierConversionWithRetries(inputPath, m3u8Path, segmentPattern string, opts HLSOptions, tier QualityTier, useGPU bool, hasAudio bool, videoOnly bool) (*HLSResult, error) {
	var result *HLSResult
	err := withMemoryRetries("tier "+tier.Name, func() error {
		r, e := runTierConversion(inputPath, m3u8Path, segmentPattern, opts, tier, useGPU, hasAudio, videoOnly)
		if e != nil {
			return e
		}
		result = r
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
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

// execEncode runs one ffmpeg invocation (with timeout + memory governor) and
// salvages partial output when enough segments were already written. Returns
// the segment list on success. Shared by the video and audio encoders.
func execEncode(args []string, m3u8Path string) ([]string, error) {
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
			// usable output. Salvage what we have  the m3u8 references written
			// segments and HLS players handle a truncated stream gracefully.
			log.Printf("[ffmpeg] salvaging partial output: %d segments written despite error: %v", segCount, ffmpegErr)
		} else {
			return nil, fmt.Errorf("ffmpeg: %w, stderr: %s", ffmpegErr, ffmpegStderrTail(stderr.String(), 6000))
		}
	} else if !m3u8Exists {
		return nil, fmt.Errorf("m3u8 not created")
	}

	return segments, nil
}

func runTierConversion(inputPath, m3u8Path, segmentPattern string, opts HLSOptions, tier QualityTier, useGPU bool, hasAudio bool, videoOnly bool) (*HLSResult, error) {
	inputPath = ffmpegPathArg(inputPath)
	m3u8Path = ffmpegPathArg(m3u8Path)
	segmentPattern = ffmpegPathArg(segmentPattern)

	args := buildTierArgs(inputPath, m3u8Path, segmentPattern, opts, tier, useGPU, hasAudio, videoOnly)

	segments, err := execEncode(args, m3u8Path)
	if err != nil {
		return nil, err
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

// convertAudioTrack encodes the shared audio-only rendition (with the same
// retry/salvage machinery as the video tiers) into outputDir/audio.m3u8.
func convertAudioTrack(inputPath, outputDir string, opts HLSOptions, audioBR string) error {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return err
	}
	in := ffmpegPathArg(inputPath)
	m3u8Path := ffmpegPathArg(filepath.Join(outputDir, "audio.m3u8"))
	segmentPattern := ffmpegPathArg(filepath.Join(outputDir, "segment_%03d.ts"))
	args := buildAudioArgs(in, m3u8Path, segmentPattern, opts, audioBR)

	return withMemoryRetries("audio", func() error {
		_, err := execEncode(args, m3u8Path)
		return err
	})
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
