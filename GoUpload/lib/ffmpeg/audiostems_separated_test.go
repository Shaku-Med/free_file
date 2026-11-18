package ffmpeg

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
	"testing"
)

const testFPS = 44100.0 / 1024

// separatedTrack is band energy for a 4/4 beat at 120 BPM: kick on 1 and 3,
// snare on 2 and 4, hihat on every eighth, a bass note with each kick.
func separatedTrack(seconds float64) *SeparatedBands {
	n := int(seconds * testFPS)
	series := map[string][]float64{}
	for _, b := range stemBands {
		series[b.name] = make([]float64, n)
	}
	hit := func(name string, t, amp float64) {
		start := int(t * testFPS)
		for i := 0; i < 8 && start+i < n; i++ {
			series[name][start+i] += amp * math.Exp(-float64(i)/2)
		}
	}
	for t := 0.0; t < seconds-0.5; t += 0.5 {
		beat := int(math.Round(t / 0.5))
		if beat%2 == 0 {
			hit("kick", t, 1)
			hit("bass", t, 0.6)
			// the kick's beater click in the snare band
			hit("snare", t, 0.05)
		} else {
			hit("snare", t, 1)
		}
		hit("hihat", t, 0.4)
		hit("hihat", t+0.25, 0.4)
	}
	// separated stems are never silent: a little bleed and noise everywhere
	rng := rand.New(rand.NewSource(7))
	for _, curve := range series {
		for i := range curve {
			curve[i] += 0.01 * rng.Float64()
		}
	}
	return &SeparatedBands{FPS: testFPS, Duration: seconds, Series: series}
}

func countEvents(doc *AudioStemsFile, band string) int {
	n := 0
	for _, e := range doc.Events {
		if e.Type == band {
			n++
		}
	}
	return n
}

func TestStemsDocFromSeparatedFindsTheBeat(t *testing.T) {
	doc, err := StemsDocFromSeparated(separatedTrack(20))
	if err != nil {
		t.Fatal(err)
	}
	if !doc.HasAudio || doc.Version != 2 || doc.EnvelopeFps != testFPS/stemsEnvelopeDecim {
		t.Fatalf("bad header: %+v", doc)
	}
	// 39 beats: 20 on the kick, 19 on the snare, 78 hihats. Allow the edges.
	if k := countEvents(doc, "kick"); k < 18 || k > 20 {
		t.Fatalf("kicks = %d", k)
	}
	if s := countEvents(doc, "snare"); s < 17 || s > 19 {
		t.Fatalf("snares = %d, the kick clicks must not count", s)
	}
	if h := countEvents(doc, "hihat"); h < 70 {
		t.Fatalf("hihats = %d", h)
	}
	if b := countEvents(doc, "bass"); b < 18 {
		t.Fatalf("bass notes on kicks were suppressed: %d", b)
	}
	for i := 1; i < len(doc.Events); i++ {
		if doc.Events[i].T < doc.Events[i-1].T {
			t.Fatal("events are not in time order")
		}
	}
}

func TestStemsDocFromSeparatedRejectsBadShapes(t *testing.T) {
	cases := map[string]func(b *SeparatedBands){
		"frame rate":    func(b *SeparatedBands) { b.FPS = 5000 },
		"nan frame":     func(b *SeparatedBands) { b.FPS = math.NaN() },
		"duration":      func(b *SeparatedBands) { b.Duration = 0 },
		"long duration": func(b *SeparatedBands) { b.Duration = stemsMaxSeconds + 60 },
		"missing":       func(b *SeparatedBands) { delete(b.Series, "hihat") },
		"length":        func(b *SeparatedBands) { b.Series["bass"] = b.Series["bass"][:10] },
		"too long":      func(b *SeparatedBands) { b.Duration = 1 },
		"negative":      func(b *SeparatedBands) { b.Series["kick"][3] = -1 },
		"nan":           func(b *SeparatedBands) { b.Series["snare"][3] = math.NaN() },
		"inf":           func(b *SeparatedBands) { b.Series["other"][3] = math.Inf(1) },
	}
	for name, spoil := range cases {
		b := separatedTrack(5)
		spoil(b)
		if _, err := StemsDocFromSeparated(b); err == nil || !strings.HasPrefix(err.Error(), "separated stems:") {
			t.Errorf("%s: want an error, got %v", name, err)
		}
	}
	if _, err := StemsDocFromSeparated(nil); err == nil {
		t.Error("nil: want an error")
	}
}

func TestSplitKickSnareKeepsOnlyRealHits(t *testing.T) {
	kickE := make([]float64, 120)
	snareE := make([]float64, 120)
	bump := func(e []float64, f int, amp float64) {
		e[f] += amp
		e[f+1] += amp / 2
	}
	bump(kickE, 10, 1) // kick alone, its click in the snare band
	bump(snareE, 10, 0.08)
	bump(snareE, 30, 1) // snare alone, its thump in the kick band
	bump(kickE, 31, 0.2)
	bump(kickE, 50, 1) // kick and snare played together
	bump(snareE, 51, 1)
	bump(kickE, 70, 0.3) // a soft kick and a soft snare together
	bump(snareE, 70, 0.3)
	bump(kickE, 90, 1)   // kick alone
	bump(snareE, 100, 1) // snare alone
	kicks := []onset{{frame: 10}, {frame: 31}, {frame: 50}, {frame: 70}, {frame: 90}}
	snares := []onset{{frame: 10}, {frame: 30}, {frame: 51}, {frame: 70}, {frame: 100}}

	gotK, gotS := splitKickSnare(kicks, snares, kickE, snareE)
	frames := func(hits []onset) []int {
		var out []int
		for _, h := range hits {
			out = append(out, h.frame)
		}
		return out
	}
	if k := frames(gotK); fmt.Sprint(k) != "[10 50 70 90]" {
		t.Fatalf("kicks kept %v, want [10 50 70 90]", k)
	}
	if s := frames(gotS); fmt.Sprint(s) != "[30 51 70 100]" {
		t.Fatalf("snares kept %v, want [30 51 70 100]", s)
	}
	if len(kicks) != 5 || len(snares) != 5 {
		t.Fatal("the input slices were changed")
	}
}

// A snare's low end leaks into the drum stem's kick band. Every snare used to
// come out as a kick too, so a kick only bounce moved on the snare as well.
func TestStemsDocFromSeparatedIgnoresSnareThumps(t *testing.T) {
	for _, thump := range []float64{0.2, 0.35} {
		b := separatedTrack(20)
		kick := b.Series["kick"]
		for x := 0.5; x < 19.5; x += 1 {
			start := int(x * testFPS)
			for i := 0; i < 8 && start+i < len(kick); i++ {
				kick[start+i] += thump * math.Exp(-float64(i)/2)
			}
		}
		doc, err := StemsDocFromSeparated(b)
		if err != nil {
			t.Fatal(err)
		}
		if k := countEvents(doc, "kick"); k < 18 || k > 20 {
			t.Fatalf("thump %.2f: kicks = %d, want only the 20 real ones", thump, k)
		}
		if s := countEvents(doc, "snare"); s < 17 || s > 19 {
			t.Fatalf("thump %.2f: snares = %d", thump, s)
		}
	}
}
