package ffmpeg

import (
	"math"
	"math/rand"
	"testing"
)

// musicDoc builds a stems doc resembling a SONG: kicks on a steady 120 BPM
// grid, snares on the off-beat, busy hihats, sustained melodic envelope.
func musicDoc(durationS float64) *AudioStemsFile {
	doc := emptyStemsDoc()
	doc.HasAudio = true
	doc.Duration = durationS

	beat := 0.5 // 120 BPM
	for t := 0.0; t < durationS; t += beat {
		doc.Events = append(doc.Events, StemEvent{T: t, Type: "kick", Strength: 0.9})
		doc.Events = append(doc.Events, StemEvent{T: t + beat/2, Type: "snare", Strength: 0.7})
		doc.Events = append(doc.Events, StemEvent{T: t + beat/4, Type: "hihat", Strength: 0.5})
		doc.Events = append(doc.Events, StemEvent{T: t + 3*beat/4, Type: "hihat", Strength: 0.5})
	}

	frames := int(durationS * doc.EnvelopeFps)
	for _, band := range []string{"kick", "bass", "hihat", "other"} {
		env := make([]float64, frames)
		for i := range env {
			env[i] = 0.4 + 0.3*math.Sin(float64(i)*0.3)
			if env[i] < 0 {
				env[i] = 0
			}
		}
		doc.Envelopes[band] = env
	}
	return doc
}

// speechDoc resembles TALKING: irregular sparse onsets, no treble percussion,
// frequent pauses in the melodic band.
func speechDoc(durationS float64) *AudioStemsFile {
	doc := emptyStemsDoc()
	doc.HasAudio = true
	doc.Duration = durationS
	rng := rand.New(rand.NewSource(7))

	t := 0.0
	for t < durationS {
		t += 0.25 + rng.Float64()*2.2 // irregular gaps
		doc.Events = append(doc.Events, StemEvent{T: t, Type: "other", Strength: 0.5})
		if rng.Float64() < 0.25 {
			doc.Events = append(doc.Events, StemEvent{T: t + 0.05, Type: "snare", Strength: 0.3})
		}
	}

	frames := int(durationS * doc.EnvelopeFps)
	for _, band := range []string{"kick", "bass", "hihat", "other"} {
		env := make([]float64, frames)
		for i := range env {
			// speech: mid band bursts with pauses, no sub-bass, no hats
			if band == "other" && rng.Float64() < 0.45 {
				env[i] = 0.3
			} else if band == "bass" && rng.Float64() < 0.15 {
				env[i] = 0.15
			}
		}
		doc.Envelopes[band] = env
	}
	return doc
}

func TestMusicScoreHighForMusic(t *testing.T) {
	score := MusicScore(musicDoc(60))
	if score < 0.6 {
		t.Fatalf("expected music score >= 0.6 for steady 120BPM track, got %.2f", score)
	}
}

func TestMusicScoreLowForSpeech(t *testing.T) {
	score := MusicScore(speechDoc(60))
	if score >= 0.5 {
		t.Fatalf("expected speech score < 0.5, got %.2f", score)
	}
}

func TestMusicScoreZeroEdges(t *testing.T) {
	if MusicScore(nil) != 0 {
		t.Fatal("nil doc must score 0")
	}
	doc := emptyStemsDoc()
	if MusicScore(doc) != 0 {
		t.Fatal("silent doc must score 0")
	}
	short := musicDoc(4) // under the 8s floor
	if MusicScore(short) != 0 {
		t.Fatal("too-short audio must score 0")
	}
}
