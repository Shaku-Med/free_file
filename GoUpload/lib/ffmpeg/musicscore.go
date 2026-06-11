package ffmpeg

import (
	"math"
	"sort"
)

// Music detection from the stems analysis (no extra decode, no ML).
// Music has a measurable signature that speech / ambient noise lacks:
//
//   1. Beat regularity  kick/snare onsets repeat at ONE stable tempo.
//      Inter-onset intervals of a song pile into a tight histogram bin;
//      talking scatters everywhere. The single strongest signal.
//   2. Band coverage  music drives sub-bass AND treble simultaneously
//      (kick + hihat envelopes both alive); speech lives in a narrow lane.
//   3. Onset density  a steady stream of percussive events per second.
//   4. Sustain  musical frames dominate the timeline, so a 10s intro
//      jingle on a 10min vlog can't tag the whole file.
//
// Output is 0..1; the worker tags "Music" above a threshold.

const (
	// IOI histogram bin width in seconds (~12ms = tight but tolerant).
	musicIOIBinS = 0.012
	// Tempo sanity window for the dominant inter-onset interval. Wide on the
	// fast end because kick+snare interleave HALVES the apparent interval
	// (120 BPM kick/snare alternation = 0.25s gaps = "240 BPM").
	musicMinIOIS = 60.0 / 360.0 // 360 events/min
	musicMaxIOIS = 60.0 / 40.0  // 40 BPM
	// Envelope activity floor when measuring band coverage / sustain.
	musicEnvActive = 0.12
)

// MusicScore rates how "musical" the analyzed audio is (0..1).
func MusicScore(doc *AudioStemsFile) float64 {
	if doc == nil || !doc.HasAudio || doc.Duration < 8 {
		return 0
	}

	beat := beatRegularity(doc)
	coverage := bandCoverage(doc)
	density := onsetDensity(doc)
	sustain := musicalSustain(doc)

	score := beat*0.45 + coverage*0.2 + density*0.15 + sustain*0.2
	return math.Max(0, math.Min(1, score))
}

// beatRegularity: fraction of kick/snare inter-onset intervals agreeing on
// one tempo bin (including its half/double  songs alternate kick/snare).
func beatRegularity(doc *AudioStemsFile) float64 {
	var times []float64
	for _, e := range doc.Events {
		if e.Type == "kick" || e.Type == "snare" {
			times = append(times, e.T)
		}
	}
	if len(times) < 8 {
		return 0
	}
	sort.Float64s(times)

	bins := map[int]int{}
	total := 0
	for i := 1; i < len(times); i++ {
		ioi := times[i] - times[i-1]
		if ioi < musicMinIOIS || ioi > musicMaxIOIS {
			continue
		}
		bins[int(ioi/musicIOIBinS)]++
		total++
	}
	if total < 6 {
		return 0
	}

	best, bestBin := 0, 0
	for b, c := range bins {
		if c > best {
			best = c
			bestBin = b
		}
	}
	// Tempo families: the dominant interval plus its half and double (and
	// immediate neighbor bins for jitter) all count as "on the grid".
	onGrid := 0
	for b, c := range bins {
		if absInt(b-bestBin) <= 1 || absInt(b-bestBin*2) <= 2 || absInt(b*2-bestBin) <= 2 {
			onGrid += c
		}
	}
	return math.Min(1, float64(onGrid)/float64(total)*1.15)
}

// bandCoverage: fraction of time where lows (kick/bass) AND highs (hihat)
// are active together.
func bandCoverage(doc *AudioStemsFile) float64 {
	kick := doc.Envelopes["kick"]
	bass := doc.Envelopes["bass"]
	hihat := doc.Envelopes["hihat"]
	n := minLen(len(kick), len(bass), len(hihat))
	if n < 8 {
		return 0
	}
	both := 0
	for i := 0; i < n; i++ {
		low := math.Max(at(kick, i), at(bass, i))
		if low >= musicEnvActive && at(hihat, i) >= musicEnvActive {
			both++
		}
	}
	return math.Min(1, float64(both)/float64(n)*1.6)
}

// onsetDensity: percussive events per second, peaking around 1-6/s.
func onsetDensity(doc *AudioStemsFile) float64 {
	if doc.Duration <= 0 {
		return 0
	}
	perc := 0
	for _, e := range doc.Events {
		if e.Type == "kick" || e.Type == "snare" || e.Type == "hihat" {
			perc++
		}
	}
	rate := float64(perc) / doc.Duration
	switch {
	case rate < 0.4:
		return rate / 0.4 * 0.3
	case rate <= 6:
		return 1
	case rate <= 12:
		return 1 - (rate-6)/12
	default:
		return 0.3
	}
}

// musicalSustain: fraction of the timeline where the melodic band carries
// energy  music keeps playing, speech pauses constantly.
func musicalSustain(doc *AudioStemsFile) float64 {
	other := doc.Envelopes["other"]
	if len(other) < 8 {
		return 0
	}
	active := 0
	for _, v := range other {
		if v >= musicEnvActive {
			active++
		}
	}
	return float64(active) / float64(len(other))
}

func at(xs []float64, i int) float64 {
	if i < 0 || i >= len(xs) {
		return 0
	}
	return xs[i]
}

func minLen(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
