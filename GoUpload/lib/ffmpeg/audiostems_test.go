package ffmpeg

import (
	"math"
	"math/rand"
	"testing"
)

// synthKickTrack: silence with 80 Hz decaying sine bursts (kick-like) at the
// given times, over a quiet noise floor so has_audio trips.
func synthKickTrack(durationS float64, kickTimes []float64) []float64 {
	n := int(durationS * stemsSampleRate)
	out := make([]float64, n)
	rng := rand.New(rand.NewSource(42))
	for i := range out {
		out[i] = (rng.Float64()*2 - 1) * 0.02
	}
	for _, t := range kickTimes {
		start := int(t * stemsSampleRate)
		burst := int(math.Round(0.09 * float64(stemsSampleRate)))
		for i := 0; i < burst && start+i < n; i++ {
			ts := float64(i) / stemsSampleRate
			decay := math.Exp(-ts * 35)
			out[start+i] += 0.9 * decay * math.Sin(2*math.Pi*80*ts)
		}
	}
	return out
}

func TestAnalyzeStemsDetectsKicks(t *testing.T) {
	kicks := []float64{0.5, 1.0, 1.5, 2.0, 2.5}
	doc := analyzeStems(synthKickTrack(3.5, kicks), stemsSampleRate)

	if !doc.HasAudio {
		t.Fatal("expected has_audio true")
	}

	var kickEvents []StemEvent
	for _, e := range doc.Events {
		if e.Type == "kick" {
			kickEvents = append(kickEvents, e)
		}
	}
	if len(kickEvents) < len(kicks) {
		t.Fatalf("expected >= %d kick events, got %d (%v)", len(kicks), len(kickEvents), kickEvents)
	}

	const tolerance = 0.08
	for _, want := range kicks {
		found := false
		for _, e := range kickEvents {
			if math.Abs(e.T-want) <= tolerance {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("no kick event near t=%.2f (events: %v)", want, kickEvents)
		}
	}

	for _, e := range doc.Events {
		if e.Strength < 0 || e.Strength > 1 {
			t.Fatalf("strength out of range: %+v", e)
		}
		if e.T < 0 || e.T > doc.Duration {
			t.Fatalf("event time out of range: %+v", e)
		}
	}
}

func TestAnalyzeStemsSilence(t *testing.T) {
	doc := analyzeStems(make([]float64, stemsSampleRate*2), stemsSampleRate)
	if doc.HasAudio {
		t.Fatal("expected has_audio false on silence")
	}
	if len(doc.Events) != 0 {
		t.Fatalf("expected no events on silence, got %d", len(doc.Events))
	}
}

func TestAnalyzeStemsEnvelopes(t *testing.T) {
	doc := analyzeStems(synthKickTrack(2.0, []float64{0.5, 1.0}), stemsSampleRate)
	for _, band := range doc.Bands {
		env := doc.Envelopes[band]
		if len(env) == 0 {
			t.Fatalf("missing envelope for band %s", band)
		}
		for _, v := range env {
			if v < 0 || v > 1 {
				t.Fatalf("envelope value out of range for %s: %v", band, v)
			}
		}
	}
	if doc.EnvelopeFps <= 0 {
		t.Fatal("envelope fps must be positive")
	}
}

func TestSuppressOverlappingEvents(t *testing.T) {
	in := []StemEvent{
		{T: 1.00, Type: "kick", Strength: 1},
		{T: 1.02, Type: "bass", Strength: 0.8},  // same strike -> dropped
		{T: 1.05, Type: "other", Strength: 0.5}, // same strike -> dropped
		{T: 1.40, Type: "bass", Strength: 0.7},  // standalone -> kept
		{T: 2.00, Type: "snare", Strength: 0.9},
		{T: 2.03, Type: "hihat", Strength: 0.6}, // hihat never suppressed
	}
	out := suppressOverlappingEvents(in)
	types := map[string]int{}
	for _, e := range out {
		types[e.Type]++
	}
	if types["kick"] != 1 || types["bass"] != 1 || types["other"] != 0 || types["snare"] != 1 || types["hihat"] != 1 {
		t.Fatalf("unexpected suppression result: %+v", out)
	}
}

func TestFFTSineBin(t *testing.T) {
	// 512-sample FFT of a pure sine at bin 8 must peak at bin 8.
	const n = 512
	re := make([]float64, n)
	im := make([]float64, n)
	for i := 0; i < n; i++ {
		re[i] = math.Sin(2 * math.Pi * 8 * float64(i) / n)
	}
	fftInPlace(re, im)
	best, bestMag := 0, 0.0
	for k := 1; k < n/2; k++ {
		m := math.Hypot(re[k], im[k])
		if m > bestMag {
			bestMag = m
			best = k
		}
	}
	if best != 8 {
		t.Fatalf("expected FFT peak at bin 8, got %d", best)
	}
}
