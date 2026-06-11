package ffmpeg

import (
	"math"
	"math/rand"
	"testing"
)

// synthMelody: tone sequence (new note every 250ms, several harmonics) over a
// quiet noise floor  enough spectral structure for a constellation map.
// The seed SHUFFLES the note order, so different seeds = different melodies.
func synthMelody(durationS float64, seed int64) []float64 {
	n := int(durationS * float64(stemsSampleRate))
	out := make([]float64, n)
	rng := rand.New(rand.NewSource(seed))
	freqs := []float64{220, 247, 262, 294, 330, 349, 392, 440, 494, 523}
	rng.Shuffle(len(freqs), func(i, j int) { freqs[i], freqs[j] = freqs[j], freqs[i] })

	noteLen := stemsSampleRate / 4
	for i := 0; i < n; i++ {
		note := (i / noteLen) % len(freqs)
		f := freqs[note]
		ts := float64(i) / float64(stemsSampleRate)
		out[i] = 0.5*math.Sin(2*math.Pi*f*ts) +
			0.25*math.Sin(2*math.Pi*2*f*ts) +
			0.12*math.Sin(2*math.Pi*3*f*ts) +
			(rng.Float64()*2-1)*0.01
	}
	return out
}

// histogramBestDelta mimics the SQL matcher: count (offsetA - offsetB) per
// shared hash, return the most common delta and its vote count.
func histogramBestDelta(full, clip []AudioFingerprint) (bestDelta int32, votes int) {
	fullByHash := map[uint32][]int32{}
	for _, fp := range full {
		fullByHash[fp.Hash] = append(fullByHash[fp.Hash], fp.Offset)
	}
	counts := map[int32]int{}
	for _, fp := range clip {
		for _, off := range fullByHash[fp.Hash] {
			counts[off-fp.Offset]++
		}
	}
	for d, c := range counts {
		if c > votes {
			votes = c
			bestDelta = d
		}
	}
	return bestDelta, votes
}

func TestFingerprintClipMatchesOriginal(t *testing.T) {
	full := synthMelody(12, 1)
	fullFp := FingerprintPCM(full, stemsSampleRate)
	if len(fullFp) < 50 {
		t.Fatalf("expected a healthy fingerprint count for 12s of melody, got %d", len(fullFp))
	}

	// Clip = the original starting at 4.0s (a "sub" containing an excerpt).
	clipStart := 4 * stemsSampleRate
	clip := full[clipStart:]
	clipFp := FingerprintPCM(clip, stemsSampleRate)
	if len(clipFp) < 30 {
		t.Fatalf("expected fingerprints for the clip, got %d", len(clipFp))
	}

	delta, votes := histogramBestDelta(fullFp, clipFp)
	if votes < 20 {
		t.Fatalf("expected strong offset agreement between clip and original, got %d votes", votes)
	}

	expectedDelta := int32(clipStart / stemsHopSize)
	if math.Abs(float64(delta-expectedDelta)) > 3 {
		t.Fatalf("expected offset delta ~%d frames, got %d (votes=%d)", expectedDelta, delta, votes)
	}
}

func TestFingerprintUnrelatedAudioDoesNotMatch(t *testing.T) {
	a := FingerprintPCM(synthMelody(10, 1), stemsSampleRate)
	// Different note timing via different seed AND reversed-ish freqs by
	// offsetting the start  unrelated content.
	other := synthMelody(10, 99)
	for i := range other {
		other[i] *= 0.8
	}
	b := FingerprintPCM(other, stemsSampleRate)
	if len(a) == 0 || len(b) == 0 {
		t.Fatal("expected fingerprints for both signals")
	}

	_, votes := histogramBestDelta(a, b)
	// Same melody generator → some shared hashes, but no single offset should
	// collect anywhere near a real match's vote count.
	matched, _ := histogramBestDelta(a, a)
	_ = matched
	if votes > len(b)/4 {
		t.Fatalf("unrelated audio collected too many aligned votes: %d of %d", votes, len(b))
	}
}

func TestFingerprintSilenceEmitsNothing(t *testing.T) {
	silence := make([]float64, stemsSampleRate*5)
	if got := FingerprintPCM(silence, stemsSampleRate); len(got) != 0 {
		t.Fatalf("expected no fingerprints for silence, got %d", len(got))
	}
}

func TestFingerprintHashPacking(t *testing.T) {
	h := packFingerprintHash(511, 300, 120)
	if h>>18&0x1FF != 511 || h>>9&0x1FF != 300 || h&0x1FF != 120 {
		t.Fatalf("hash pack/unpack mismatch: %x", h)
	}
}
