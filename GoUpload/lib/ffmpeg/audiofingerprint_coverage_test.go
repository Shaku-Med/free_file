package ffmpeg

import (
	"math"
	"math/rand"
	"testing"
)

// Synthetic tone-and-noise audio with enough spectral variety to yield peaks.
func synthAudio(seconds int, sampleRate int, seed int64, gain float64) []float64 {
	rng := rand.New(rand.NewSource(seed))
	n := seconds * sampleRate
	out := make([]float64, n)
	for i := 0; i < n; i++ {
		t := float64(i) / float64(sampleRate)
		v := math.Sin(2*math.Pi*(220+80*math.Sin(t*0.7))*t) * 0.6
		v += math.Sin(2*math.Pi*(900+400*math.Sin(t*0.23))*t) * 0.3
		v += math.Sin(2*math.Pi*(3000+900*math.Sin(t*1.7))*t) * 0.2
		v += rng.NormFloat64() * 0.02
		out[i] = v * gain
	}
	return out
}

// The whole point of the fix: a long recording must be fingerprinted across its
// full length, not just the opening seconds. Truncating to the head is why a
// reel built from the chorus could never match the original.
func TestFingerprintCoversWholeRecording(t *testing.T) {
	const secs = 180
	samples := synthAudio(secs, stemsSampleRate, 1, 1.0)
	fps := float64(stemsSampleRate) / float64(stemsHopSize)

	fps_ := FingerprintPCM(samples, stemsSampleRate)
	if len(fps_) == 0 {
		t.Fatal("no fingerprints produced")
	}

	var maxOff int32
	for _, f := range fps_ {
		if f.Offset > maxOff {
			maxOff = f.Offset
		}
	}
	covered := float64(maxOff) / fps
	if covered < float64(secs)*0.8 {
		t.Fatalf("only %.1fs of %ds covered; fingerprints are still truncating to the head",
			covered, secs)
	}
}

// Loudness must not change the hashes: peak picking compares against a running
// per-band average, so scaling the signal scales both sides.
func TestFingerprintIsAmplitudeInvariant(t *testing.T) {
	quiet := synthAudio(30, stemsSampleRate, 7, 0.25)
	loud := synthAudio(30, stemsSampleRate, 7, 1.0)

	a := FingerprintPCM(quiet, stemsSampleRate)
	b := FingerprintPCM(loud, stemsSampleRate)
	if len(a) == 0 || len(b) == 0 {
		t.Fatal("no fingerprints produced")
	}

	set := make(map[uint32]bool, len(a))
	for _, f := range a {
		set[f.Hash] = true
	}
	shared := 0
	seen := make(map[uint32]bool, len(b))
	for _, f := range b {
		if seen[f.Hash] {
			continue
		}
		seen[f.Hash] = true
		if set[f.Hash] {
			shared++
		}
	}
	ratio := float64(shared) / float64(len(seen))
	if ratio < 0.8 {
		t.Fatalf("only %.0f%% of hashes survive a 4x gain change; matching would fail on a louder re-upload", ratio*100)
	}
}

// A clip taken from the MIDDLE of a track must still share hashes with the full
// recording. This is the reel-uses-the-chorus case.
func TestClipFromMiddleStillMatches(t *testing.T) {
	full := synthAudio(120, stemsSampleRate, 3, 1.0)
	start := 70 * stemsSampleRate
	clip := full[start : start+20*stemsSampleRate]

	fullFp := FingerprintPCM(full, stemsSampleRate)
	clipFp := FingerprintPCM(clip, stemsSampleRate)
	if len(fullFp) == 0 || len(clipFp) == 0 {
		t.Fatal("no fingerprints produced")
	}

	set := make(map[uint32]bool, len(fullFp))
	for _, f := range fullFp {
		set[f.Hash] = true
	}
	shared, distinct := 0, 0
	seen := make(map[uint32]bool, len(clipFp))
	for _, f := range clipFp {
		if seen[f.Hash] {
			continue
		}
		seen[f.Hash] = true
		distinct++
		if set[f.Hash] {
			shared++
		}
	}
	ratio := float64(shared) / float64(distinct)
	if ratio < matchRatioFloor {
		t.Fatalf("clip from 70s shares only %.0f%% of its hashes with the full track", ratio*100)
	}
}

// Mirrors fingerprintdb's matchRatio so the two stay in sight of each other.
const matchRatioFloor = 0.18
