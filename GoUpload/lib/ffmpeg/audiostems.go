package ffmpeg

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Audio stems analysis: server-side onset detection per instrument band.
// The player used to guess kicks from a live AnalyserNode in the browser,
// which drifts with volume/EQ and misses fast hits. Here we STFT the real
// audio once at upload time and ship "audio_stems.json" next to
// waveform.json. v2 adds per-band `envelopes` (peak-decimated wave spikes)
// for the SVG visualizer; v1 clients still use `events` only.

const (
	stemsSampleRate = 22050
	stemsFFTSize    = 1024
	stemsHopSize    = 512
	// Analyze at most 30 min of audio; longer tails rarely need confetti and
	// this bounds worker CPU/memory per job.
	stemsMaxSeconds = 1800
	// Envelope frames are averaged in groups of 4: 22050/512 ≈ 43 fps → ~10.8 fps.
	stemsEnvelopeDecim = 4
	stemsMinPCMBytes   = stemsFFTSize * 2
)

// Band edges in Hz. Snare combines a body band with a noise band (checked
// together); "other" covers melodic content for the generic instrument color.
var stemBands = []struct {
	name   string
	lo, hi float64
}{
	{"kick", 30, 130},
	{"bass", 60, 250},
	{"snare", 140, 500},
	{"hihat", 5000, 10000},
	{"other", 250, 2000},
}

// Per-band minimum spacing between onsets (seconds).
var stemMinGap = map[string]float64{
	"kick":  0.12,
	"bass":  0.14,
	"snare": 0.10,
	"hihat": 0.06,
	"other": 0.18,
}

type StemEvent struct {
	T        float64 `json:"t"`
	Type     string  `json:"type"`
	Strength float64 `json:"s"`
}

type AudioStemsFile struct {
	Version     int                  `json:"version"`
	HasAudio    bool                 `json:"has_audio"`
	Duration    float64              `json:"duration"`
	EnvelopeFps float64              `json:"envelope_fps"`
	Bands       []string             `json:"bands"`
	Envelopes   map[string][]float64 `json:"envelopes"`
	Events      []StemEvent          `json:"events"`
}

type AudioStemsResult struct {
	Path       string
	HasAudio   bool
	EventCount int
	// MusicScore 0..1  how musical the audio is (see musicscore.go).
	MusicScore float64
}

// ExtractAudioStems decodes mono PCM, runs band onset analysis, and writes
// audio_stems.json into outputDir. Like ExtractWaveform it always writes a
// file (empty doc on silent/no-audio inputs) so the client can rely on a
// stable 200/404 split per upload folder.
func ExtractAudioStems(videoPath, outputDir string) (*AudioStemsResult, error) {
	res, _, err := ExtractAudioStemsAndFingerprints(videoPath, outputDir)
	return res, err
}

// ExtractAudioStemsAndFingerprints runs BOTH audio analyses off a single PCM
// decode: the visualizer stems doc (written to audio_stems.json) and the
// Shazam-style duplicate-detection fingerprints (returned for the webhook).
func ExtractAudioStemsAndFingerprints(videoPath, outputDir string) (*AudioStemsResult, []AudioFingerprint, error) {
	if err := os.MkdirAll(outputDir, 0700); err != nil {
		return nil, nil, fmt.Errorf("create output dir: %w", err)
	}
	outPath := filepath.Join(outputDir, "audio_stems.json")

	samples, perr := extractStemsPCM(videoPath, outputDir)
	var doc *AudioStemsFile
	var fingerprints []AudioFingerprint
	if perr != nil || len(samples) == 0 {
		doc = emptyStemsDoc()
	} else {
		doc = analyzeStems(samples, stemsSampleRate)
		if doc.HasAudio {
			fingerprints = FingerprintPCM(samples, stemsSampleRate)
		}
	}

	buf, merr := json.Marshal(doc)
	if merr != nil {
		return nil, nil, fmt.Errorf("marshal stems: %w", merr)
	}
	if werr := os.WriteFile(outPath, buf, 0644); werr != nil {
		return nil, nil, fmt.Errorf("write stems json: %w", werr)
	}
	return &AudioStemsResult{
		Path:       outPath,
		HasAudio:   doc.HasAudio,
		EventCount: len(doc.Events),
		MusicScore: math.Round(MusicScore(doc)*100) / 100,
	}, fingerprints, perr
}

func emptyStemsDoc() *AudioStemsFile {
	names := make([]string, len(stemBands))
	envs := make(map[string][]float64, len(stemBands))
	for i, b := range stemBands {
		names[i] = b.name
		envs[b.name] = []float64{}
	}
	return &AudioStemsFile{
		Version:     2,
		HasAudio:    false,
		EnvelopeFps: float64(stemsSampleRate) / float64(stemsHopSize) / float64(stemsEnvelopeDecim),
		Bands:       names,
		Envelopes:   envs,
		Events:      []StemEvent{},
	}
}

func extractStemsPCM(videoPath, tmpDir string) ([]float64, error) {
	pcmPath := filepath.Join(tmpDir, "stems_tmp.pcm")
	defer os.Remove(pcmPath)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	args := []string{
		"-nostdin",
		"-fflags", "+genpts+igndts+discardcorrupt",
		"-err_detect", "ignore_err",
		"-i", ffmpegPathArg(videoPath),
		"-vn",
		"-t", fmt.Sprintf("%d", stemsMaxSeconds),
		"-ac", "1",
		"-ar", fmt.Sprintf("%d", stemsSampleRate),
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
		return nil, fmt.Errorf("ffmpeg stems extract: %w, stderr: %s", ffmpegErr, stderr.String())
	}
	if len(raw) < stemsMinPCMBytes {
		return nil, fmt.Errorf("audio too short for stems (%d bytes)", len(raw))
	}

	total := len(raw) / 2
	samples := make([]float64, total)
	for i := 0; i < total; i++ {
		s := int16(binary.LittleEndian.Uint16(raw[i*2 : i*2+2]))
		samples[i] = float64(s) / 32768.0
	}
	return samples, nil
}

// analyzeStems runs the STFT + per-band spectral-flux onset detection.
// Pure function over samples so it's unit-testable without ffmpeg.
func analyzeStems(samples []float64, sampleRate int) *AudioStemsFile {
	doc := emptyStemsDoc()
	if len(samples) < stemsFFTSize {
		return doc
	}
	doc.Duration = math.Round(float64(len(samples))/float64(sampleRate)*1000) / 1000

	frames := 1 + (len(samples)-stemsFFTSize)/stemsHopSize
	if frames < 4 {
		return doc
	}

	window := hannWindow(stemsFFTSize)
	binHz := float64(sampleRate) / float64(stemsFFTSize)

	// Per-band energy per frame
	bandEnergy := make([][]float64, len(stemBands))
	for i := range bandEnergy {
		bandEnergy[i] = make([]float64, frames)
	}

	re := make([]float64, stemsFFTSize)
	im := make([]float64, stemsFFTSize)
	var globalRMS float64

	for f := 0; f < frames; f++ {
		off := f * stemsHopSize
		var frameRMS float64
		for i := 0; i < stemsFFTSize; i++ {
			v := samples[off+i]
			re[i] = v * window[i]
			im[i] = 0
			frameRMS += v * v
		}
		globalRMS += math.Sqrt(frameRMS / stemsFFTSize)
		fftInPlace(re, im)

		for b, band := range stemBands {
			loBin := int(math.Max(1, math.Floor(band.lo/binHz)))
			hiBin := int(math.Min(float64(stemsFFTSize/2-1), math.Ceil(band.hi/binHz)))
			if hiBin < loBin {
				continue
			}
			var e float64
			for k := loBin; k <= hiBin; k++ {
				e += math.Hypot(re[k], im[k])
			}
			bandEnergy[b][f] = e / float64(hiBin-loBin+1)
		}
	}

	doc.HasAudio = globalRMS/float64(frames) >= hasAudioRMSThreshold
	if !doc.HasAudio {
		return doc
	}

	frameDur := float64(stemsHopSize) / float64(sampleRate)
	var events []StemEvent

	for b, band := range stemBands {
		env := bandEnergy[b]
		doc.Envelopes[band.name] = decimateEnvelope(env, stemsEnvelopeDecim)
		minGapFrames := int(math.Ceil(stemMinGap[band.name] / frameDur))
		for _, on := range detectOnsets(env, minGapFrames) {
			events = append(events, StemEvent{
				T:        math.Round(float64(on.frame)*frameDur*1000) / 1000,
				Type:     band.name,
				Strength: math.Round(on.strength*100) / 100,
			})
		}
	}

	sort.Slice(events, func(i, j int) bool { return events[i].T < events[j].T })
	doc.Events = suppressOverlappingEvents(events)
	doc.Version = 2
	return doc
}

type onset struct {
	frame    int
	strength float64
}

// detectOnsets: positive spectral flux vs. an adaptive local threshold
// (sliding mean + k·std), then local-max peak picking with a minimum gap.
func detectOnsets(energy []float64, minGapFrames int) []onset {
	n := len(energy)
	if n < 4 {
		return nil
	}
	flux := make([]float64, n)
	for i := 1; i < n; i++ {
		d := energy[i] - energy[i-1]
		if d > 0 {
			flux[i] = d
		}
	}

	// Normalize flux by its 95th percentile so thresholds and strengths are
	// input-level independent.
	p95 := percentile(flux, 0.95)
	if p95 <= 0 {
		return nil
	}
	for i := range flux {
		flux[i] /= p95
	}

	const win = 22 // ~0.5s context at 43 fps
	var out []onset
	lastFrame := -1 << 30

	for i := 2; i < n-2; i++ {
		// local max over ±2 frames
		if flux[i] < flux[i-1] || flux[i] < flux[i-2] || flux[i] <= flux[i+1] || flux[i] <= flux[i+2] {
			continue
		}
		lo := i - win
		if lo < 0 {
			lo = 0
		}
		hi := i + win
		if hi > n {
			hi = n
		}
		mean, std := meanStd(flux[lo:hi])
		thr := mean + 1.5*std + 0.05
		if flux[i] <= thr {
			continue
		}
		if i-lastFrame < minGapFrames {
			continue
		}
		lastFrame = i
		s := flux[i]
		if s > 1 {
			s = 1
		}
		out = append(out, onset{frame: i, strength: s})
	}
	return out
}

// suppressOverlappingEvents drops redundant events that describe the same
// strike: a kick onset also bumps the bass and "other" bands, so within a
// 70ms window kick wins over bass, and kick/snare win over "other".
func suppressOverlappingEvents(events []StemEvent) []StemEvent {
	const window = 0.07
	out := events[:0]
	for i, e := range events {
		drop := false
		if e.Type == "bass" || e.Type == "other" {
			for j := i - 1; j >= 0 && e.T-events[j].T <= window; j-- {
				if dominates(events[j].Type, e.Type) {
					drop = true
					break
				}
			}
			if !drop {
				for j := i + 1; j < len(events) && events[j].T-e.T <= window; j++ {
					if dominates(events[j].Type, e.Type) {
						drop = true
						break
					}
				}
			}
		}
		if !drop {
			out = append(out, e)
		}
	}
	return out
}

func dominates(winner, loser string) bool {
	if loser == "bass" {
		return winner == "kick"
	}
	if loser == "other" {
		return winner == "kick" || winner == "snare"
	}
	return false
}

// decimateEnvelope downsamples band energy for the visualizer wave lines.
// Each bucket uses the peak (not the mean) so transients/spikes stay visible.
// Normalized by the band's 98th percentile, NOT its max: one freak spike used
// to flatten the whole wave to near-zero; with p98 the body of the wave keeps
// its shape and the outlier just clamps to 1.0.
func decimateEnvelope(env []float64, factor int) []float64 {
	if factor < 1 {
		factor = 1
	}
	norm := percentile(env, 0.98)
	if norm <= 0 {
		for _, v := range env {
			if v > norm {
				norm = v
			}
		}
	}
	out := make([]float64, 0, len(env)/factor+1)
	for i := 0; i < len(env); i += factor {
		end := i + factor
		if end > len(env) {
			end = len(env)
		}
		peak := 0.0
		for j := i; j < end; j++ {
			if env[j] > peak {
				peak = env[j]
			}
		}
		v := peak
		if norm > 0 {
			v = math.Min(1.0, v/norm)
		}
		out = append(out, math.Round(v*1000)/1000)
	}
	return out
}

func meanStd(xs []float64) (mean, std float64) {
	if len(xs) == 0 {
		return 0, 0
	}
	for _, v := range xs {
		mean += v
	}
	mean /= float64(len(xs))
	for _, v := range xs {
		d := v - mean
		std += d * d
	}
	std = math.Sqrt(std / float64(len(xs)))
	return mean, std
}

func percentile(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	cp := make([]float64, len(xs))
	copy(cp, xs)
	sort.Float64s(cp)
	idx := int(p * float64(len(cp)-1))
	return cp[idx]
}

func hannWindow(n int) []float64 {
	w := make([]float64, n)
	for i := 0; i < n; i++ {
		w[i] = 0.5 * (1 - math.Cos(2*math.Pi*float64(i)/float64(n-1)))
	}
	return w
}

// fftInPlace: iterative radix-2 Cooley-Tukey. len(re) must be a power of two.
func fftInPlace(re, im []float64) {
	n := len(re)
	if n <= 1 {
		return
	}
	// bit-reversal permutation
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			re[i], re[j] = re[j], re[i]
			im[i], im[j] = im[j], im[i]
		}
	}
	for length := 2; length <= n; length <<= 1 {
		ang := -2 * math.Pi / float64(length)
		wRe, wIm := math.Cos(ang), math.Sin(ang)
		for i := 0; i < n; i += length {
			curRe, curIm := 1.0, 0.0
			half := length / 2
			for j := 0; j < half; j++ {
				aRe, aIm := re[i+j], im[i+j]
				bRe := re[i+j+half]*curRe - im[i+j+half]*curIm
				bIm := re[i+j+half]*curIm + im[i+j+half]*curRe
				re[i+j], im[i+j] = aRe+bRe, aIm+bIm
				re[i+j+half], im[i+j+half] = aRe-bRe, aIm-bIm
				nextRe := curRe*wRe - curIm*wIm
				curIm = curRe*wIm + curIm*wRe
				curRe = nextRe
			}
		}
	}
}
