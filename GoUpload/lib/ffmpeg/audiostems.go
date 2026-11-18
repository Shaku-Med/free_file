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

// On the full mix the snare band also hears a kick's punch, so a snare is
// told from a kick by its crack, the wires and stick noise up here.
const snareCrackLo, snareCrackHi = 1200.0, 4000.0

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

	crack := make([]float64, frames)
	crackLo := int(math.Floor(snareCrackLo / binHz))
	crackHi := int(math.Ceil(snareCrackHi / binHz))

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
		var e float64
		for k := crackLo; k <= crackHi; k++ {
			e += math.Hypot(re[k], im[k])
		}
		crack[f] = e / float64(crackHi-crackLo+1)
	}

	doc.HasAudio = globalRMS/float64(frames) >= hasAudioRMSThreshold
	if !doc.HasAudio {
		return doc
	}
	fillStemsDoc(doc, bandEnergy, float64(stemsHopSize)/float64(sampleRate), crack)
	return doc
}

// fillStemsDoc writes the envelopes and onset events for per band energy
// (rows in stemBands order). snareCrack is set for the full mix, whose bands
// bleed into each other, so there a kick or snare also hides the bass and
// "other" bumps it causes; separated stems don't, and a bass note landing on a
// kick is a real note.
func fillStemsDoc(doc *AudioStemsFile, bandEnergy [][]float64, frameDur float64, snareCrack []float64) {
	mixed := snareCrack != nil
	opts := separatedOnsetOpts
	if mixed {
		opts = onsetOpts{}
	}
	found := make([][]onset, len(stemBands))
	for b, band := range stemBands {
		found[b] = detectOnsetsWith(bandEnergy[b], int(math.Ceil(stemMinGap[band.name]/frameDur)), opts)
	}
	ki, si := stemBandIndex("kick"), stemBandIndex("snare")
	snareEvidence := bandEnergy[si]
	if mixed {
		snareEvidence = snareCrack
	}
	found[ki], found[si] = splitKickSnare(found[ki], found[si], bandEnergy[ki], snareEvidence)
	var events []StemEvent
	for b, band := range stemBands {
		doc.Envelopes[band.name] = decimateEnvelope(bandEnergy[b], stemsEnvelopeDecim)
		for _, on := range found[b] {
			events = append(events, StemEvent{
				T:        math.Round(float64(on.frame)*frameDur*1000) / 1000,
				Type:     band.name,
				Strength: math.Round(on.strength*100) / 100,
			})
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].T < events[j].T })
	if mixed {
		events = suppressOverlappingEvents(events)
	}
	if events == nil {
		events = []StemEvent{}
	}
	doc.Events = events
	doc.Version = 2
}

func stemBandIndex(name string) int {
	for i, b := range stemBands {
		if b.name == name {
			return i
		}
	}
	panic("unknown stem band " + name)
}

const (
	// Kick and snare onsets this many frames apart may be one hit heard by both.
	sameHitFrames = 2
	// The weaker side of such a pair stays only if its jump, against its own
	// band's typical hit, is at least this share of the other side's. A kick's
	// beater click is a sliver of a snare's crack and a snare's thump a sliver
	// of a kick, while a kick and a snare played together both land hard.
	sameHitShare = 0.5
)

// splitKickSnare drops kick onsets that are only a snare's low thump and snare
// onsets that are only a kick's beater click. Each band hears some of the
// other drum, so one hit would otherwise fire both and a kick only visual
// would bounce on every snare.
func splitKickSnare(kicks, snares []onset, kickEnergy, snareEnergy []float64) ([]onset, []onset) {
	if len(kicks) == 0 || len(snares) == 0 {
		return kicks, snares
	}
	kr := relativeRises(kicks, kickEnergy)
	sr := relativeRises(snares, snareEnergy)
	return keepUnmasked(kicks, kr, snares, sr), keepUnmasked(snares, sr, kicks, kr)
}

// relativeRises is each onset's energy jump over its band's typical jump.
func relativeRises(hits []onset, energy []float64) []float64 {
	out := make([]float64, len(hits))
	for i, h := range hits {
		for f := max(h.frame-1, 1); f <= min(h.frame+1, len(energy)-1); f++ {
			out[i] = math.Max(out[i], energy[f]-energy[f-1])
		}
	}
	if typical := percentile(out, 0.75); typical > 0 {
		for i := range out {
			out[i] /= typical
		}
	}
	return out
}

// keepUnmasked keeps the hits that are not dwarfed by an other band hit at the
// same moment. Both lists are in frame order.
func keepUnmasked(hits []onset, rel []float64, others []onset, otherRel []float64) []onset {
	out := hits[:0:0]
	j := 0
	for i, h := range hits {
		for j < len(others) && others[j].frame < h.frame-sameHitFrames {
			j++
		}
		strongest := 0.0
		for k := j; k < len(others) && others[k].frame <= h.frame+sameHitFrames; k++ {
			strongest = math.Max(strongest, otherRel[k])
		}
		if rel[i] < sameHitShare*strongest {
			continue
		}
		out = append(out, h)
	}
	return out
}

// SeparatedBands is per band energy the stems sidecar measured on separated
// drums, bass and other stems, on a frame grid of FPS frames per second.
type SeparatedBands struct {
	FPS      float64              `json:"fps"`
	Duration float64              `json:"duration"`
	Series   map[string][]float64 `json:"series"`
}

const (
	minSeparatedFPS = 20
	maxSeparatedFPS = 100
)

// StemsDocFromSeparated builds audio_stems.json from separated stem bands, in
// the same shape the instant analysis writes, so the player reads either. The
// numbers come from another process, so their shape is checked rather than
// trusted.
func StemsDocFromSeparated(b *SeparatedBands) (*AudioStemsFile, error) {
	if b == nil || !(b.FPS >= minSeparatedFPS && b.FPS <= maxSeparatedFPS) {
		return nil, fmt.Errorf("separated stems: bad frame rate")
	}
	if !(b.Duration > 0 && b.Duration <= stemsMaxSeconds+1) {
		return nil, fmt.Errorf("separated stems: bad duration")
	}
	maxFrames := int(b.Duration*b.FPS) + 2
	frames := -1
	energy := make([][]float64, len(stemBands))
	for i, band := range stemBands {
		curve, ok := b.Series[band.name]
		if !ok {
			return nil, fmt.Errorf("separated stems: missing %s", band.name)
		}
		if frames < 0 {
			frames = len(curve)
		}
		if len(curve) != frames || frames < 4 || frames > maxFrames {
			return nil, fmt.Errorf("separated stems: bad %s length %d", band.name, len(curve))
		}
		for _, v := range curve {
			if !(v >= 0) || math.IsInf(v, 1) {
				return nil, fmt.Errorf("separated stems: bad %s value", band.name)
			}
		}
		energy[i] = curve
	}
	doc := emptyStemsDoc()
	doc.HasAudio = true
	doc.Duration = math.Round(b.Duration*1000) / 1000
	doc.EnvelopeFps = b.FPS / stemsEnvelopeDecim
	fillStemsDoc(doc, energy, 1/b.FPS, nil)
	return doc, nil
}

type onset struct {
	frame    int
	strength float64
}

// onsetOpts tune detectOnsets for separated stems; the zero value is the
// original full mix behaviour.
type onsetOpts struct {
	// logGamma > 0 compresses energy as log1p(gamma * E / p99) first, so a
	// soft hit counts next to a loud one and quiet passages keep their hits.
	logGamma float64
	// floor is the flux, as a share of its p95, every hit must also reach. It
	// keeps a stem's bleed (a kick's click in the snare band) from passing the
	// local threshold just because nothing else is near it.
	floor float64
	// loudShare raises the floor to this share of the band's loud hits (its
	// p99 flux). In a sparse band most frames are background, so p95 alone
	// measures noise and the floor stops filtering the gaps between hits.
	loudShare float64
}

var separatedOnsetOpts = onsetOpts{logGamma: 5, floor: 0.4, loudShare: 0.1}

// detectOnsets: positive spectral flux vs. an adaptive local threshold
// (sliding mean + k·std), then local-max peak picking with a minimum gap.
func detectOnsets(energy []float64, minGapFrames int) []onset {
	return detectOnsetsWith(energy, minGapFrames, onsetOpts{})
}

func detectOnsetsWith(energy []float64, minGapFrames int, opts onsetOpts) []onset {
	n := len(energy)
	if n < 4 {
		return nil
	}
	if opts.logGamma > 0 {
		if ref := percentile(energy, 0.99); ref > 0 {
			compressed := make([]float64, n)
			for i, v := range energy {
				compressed[i] = math.Log1p(opts.logGamma * v / ref)
			}
			energy = compressed
		}
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
	floor := opts.floor
	if opts.loudShare > 0 {
		floor = math.Max(floor, opts.loudShare*percentile(flux, 0.99))
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
		thr := math.Max(mean+1.5*std+0.05, floor)
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
// strike on the full mix: a kick bumps the bass and "other" bands and a
// snare's body sits in the bass band, so within a 70ms window kick and snare
// win over bass and "other".
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
	return (loser == "bass" || loser == "other") && (winner == "kick" || winner == "snare")
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
