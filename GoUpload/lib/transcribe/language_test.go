package transcribe

import (
	"strings"
	"testing"
	"time"
)

func sec(s float64) time.Duration { return time.Duration(s * float64(time.Second)) }

func TestSpeechTimelineMergesAndFallsBack(t *testing.T) {
	got := speechTimeline(sec(100), []Span{{sec(50), sec(60)}, {sec(5), sec(20)}, {sec(15), sec(30)}, {sec(95), sec(120)}})
	want := []Span{{sec(5), sec(30)}, {sec(50), sec(60)}, {sec(95), sec(100)}}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	if got := speechTimeline(sec(100), []Span{{sec(1), sec(2)}}); len(got) != 1 || got[0] != (Span{0, sec(100)}) {
		t.Fatalf("too little speech should mean the whole audio, got %v", got)
	}
	if got := speechTimeline(sec(100), nil); len(got) != 1 || got[0].End != sec(100) {
		t.Fatalf("no speech map should mean the whole audio, got %v", got)
	}
}

func TestProbePointsLandInSpeech(t *testing.T) {
	timeline := []Span{{sec(40), sec(50)}, {sec(100), sec(130)}}
	points := probePoints(timeline, 4)
	if len(points) != 4 {
		t.Fatalf("got %v", points)
	}
	for _, p := range points {
		in := false
		for _, s := range timeline {
			in = in || (p >= s.Start && p <= s.End)
		}
		if !in {
			t.Fatalf("probe at %s is outside the speech", p)
		}
	}
	// 40 s of speech in quarters: the first probe is 5 s in.
	if points[0] != sec(45) {
		t.Fatalf("first probe at %s", points[0])
	}
}

func TestAroundStaysInside(t *testing.T) {
	cases := []struct{ t, end, start, stop float64 }{
		{50, 100, 42.5, 57.5},
		{2, 100, 0, 15},
		{99, 100, 85, 100},
		{5, 8, 0, 8},
	}
	for _, c := range cases {
		got := around(sec(c.t), sec(15), sec(c.end))
		if got != (Span{sec(c.start), sec(c.stop)}) {
			t.Errorf("around(%v) = %v", c, got)
		}
	}
}

func TestPromptsFitTheirContext(t *testing.T) {
	for lang, p := range prompts {
		if p.text == "" || p.tokens < 1 || p.tokens > 32 || p.tokens > len(p.text) {
			t.Errorf("%s: %+v", lang, p)
		}
	}
	if p, ok := promptFor("AUTO"); !ok || p != prompts["en"] {
		t.Errorf("auto prompt = %+v %v", p, ok)
	}
	if _, ok := promptFor("xx"); ok {
		t.Error("prompt for an unknown language")
	}
}

func TestWindowsCutInPausesAndCoverEverything(t *testing.T) {
	speech := []Span{{0, sec(24)}, {sec(25), sec(70)}, {sec(71), sec(140)}}
	windows := windowsAt(sec(150), speech)
	if windows[0].Start != 0 || windows[len(windows)-1].End != sec(150) {
		t.Fatalf("windows don't cover the audio: %v", windows)
	}
	for i := 1; i < len(windows); i++ {
		if windows[i].Start != windows[i-1].End {
			t.Fatalf("gap or overlap at %d: %v", i, windows)
		}
	}
	if windows[0].End != sec(24.5) {
		t.Fatalf("first cut should be in the first pause, got %v", windows[0])
	}
	for _, w := range windows[:len(windows)-1] {
		if l := w.End - w.Start; l < minWindow || l > 2*windowLength {
			t.Fatalf("window %v is %s long", w, l)
		}
	}
	// No speech map: plain 30 s windows, the last one taking what's left once
	// that's no more than 40 s.
	plain := windowsAt(sec(95), nil)
	if len(plain) != 3 || plain[0] != (Span{0, sec(30)}) || plain[1] != (Span{sec(30), sec(60)}) || plain[2] != (Span{sec(60), sec(95)}) {
		t.Fatalf("plain windows: %v", plain)
	}
}

func TestRegionsSmoothUnsureWindows(t *testing.T) {
	w := []Span{{0, sec(30)}, {sec(30), sec(60)}, {sec(60), sec(90)}, {sec(90), sec(120)}, {sec(120), sec(150)}}
	labels := []probe{{"en", 0.3}, {"en", 0.95}, {"ja", 0.5}, {"fr", 0.97}, {"fr", 0.99}}
	got := regions(w, labels, "en")
	if len(got) != 2 {
		t.Fatalf("got %+v", got)
	}
	if got[0].lang != "en" || got[0].Start != 0 || got[0].End != sec(90) {
		t.Fatalf("first region %+v", got[0])
	}
	if got[1].lang != "fr" || got[1].Start != sec(90) || got[1].End != sec(150) {
		t.Fatalf("second region %+v", got[1])
	}
}

func TestVotes(t *testing.T) {
	probes := []probe{{"en", 0.99}, {"es", 0.5}, {"en", 0.9}, {"fr", 0.95}}
	if got := confidentLangs(probes); strings.Join(got, ",") != "en,fr" {
		t.Fatalf("confident = %v", got)
	}
	if got := majority(probes); got != "en" {
		t.Fatalf("majority = %q", got)
	}
	if got := majority([]probe{{"en", 0.2}}); got != "" {
		t.Fatalf("an unsure probe can't win, got %q", got)
	}
}

func TestDetectedLinesParse(t *testing.T) {
	out := `whisper_model_load: n_langs = 100
main: processing 'probe000.wav' (240000 samples, 15.0 sec) ...
whisper_full_with_state: auto-detected language: en (p = 0.999491)
main: processing 'probe001.wav' ...
whisper_full_with_state: auto-detected language: haw (p = 0.710469)`
	m := detectedRe.FindAllStringSubmatch(out, -1)
	if len(m) != 2 || m[0][1] != "en" || m[1][1] != "haw" || m[1][2] != "0.710469" {
		t.Fatalf("got %q", m)
	}
}

func TestSoundTagsGoOnLinesOrStandAlone(t *testing.T) {
	lines := []Cue{
		{Start: sec(1), End: sec(3), Text: "Hello there.", Words: []Word{{Start: sec(1), Text: "Hello"}, {Start: sec(1.5), Text: "there."}}},
		{Start: sec(10), End: sec(12), Text: "And we're back."},
	}
	tags := []Tag{
		{Span{sec(2), sec(3)}, "Laughter"},
		{Span{sec(2.5), sec(3.5)}, "Laughter"}, // same laugh, joined
		{Span{sec(5), sec(7)}, "Applause"},
		{Span{sec(9.5), sec(10.5)}, "Applause"}, // runs into the next line, so it goes on it
		{Span{sec(8), sec(8.5)}, "<b>Bad</b>"},
	}
	alone := soundCues(tags, lines)
	if lines[0].Text != "[Laughter] Hello there." || lines[0].Words[0].Text != "[Laughter]" {
		t.Fatalf("line 0 = %q %+v", lines[0].Text, lines[0].Words)
	}
	if lines[1].Text != "[Applause] And we're back." {
		t.Fatalf("line 1 = %q", lines[1].Text)
	}
	if len(alone) != 1 || alone[0].Text != "[Applause]" || alone[0].Start != sec(5) || alone[0].End != sec(7) {
		t.Fatalf("standalone = %+v", alone)
	}
	again := soundCues([]Tag{{Span{sec(1), sec(2)}, "Laughter"}}, lines)
	if len(again) != 0 || lines[0].Text != "[Laughter] Hello there." {
		t.Fatalf("a line is tagged once per sound: %q", lines[0].Text)
	}
	soundCues([]Tag{{Span{sec(1), sec(2)}, "Coughing"}, {Span{sec(1), sec(2)}, "Sneezing"}}, lines)
	if lines[0].Text != "[Coughing] [Laughter] Hello there." {
		t.Fatalf("at most two tags per line, got %q", lines[0].Text)
	}
}

func TestStandaloneTagStopsAtTheNextLine(t *testing.T) {
	lines := []Cue{{Start: sec(5.3), End: sec(7), Text: "Next."}}
	alone := soundCues([]Tag{{Span{sec(4.8), sec(5.2)}, "Gasps"}}, lines)
	if len(alone) != 1 || alone[0].End != sec(5.3) {
		t.Fatalf("got %+v", alone)
	}
}

func TestVTTWithSoundsAndNoSpeech(t *testing.T) {
	res := &Result{
		Language: "en",
		Sounds:   []Tag{{Span{sec(0), sec(12)}, "Applause"}},
		Music:    []Span{{sec(10), sec(30)}},
	}
	lang, vtt, cues, err := VTT(res)
	if err != nil {
		t.Fatal(err)
	}
	if lang != "en" || cues != 2 || !strings.Contains(vtt, "[Applause]") || !strings.Contains(vtt, "[Music]") {
		t.Fatalf("lang=%s cues=%d\n%s", lang, cues, vtt)
	}
	if strings.Index(vtt, "[Applause]") > strings.Index(vtt, "[Music]") {
		t.Fatalf("cues out of order:\n%s", vtt)
	}
}
