package transcribe

import (
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"
)

func cue(fromMs, toMs int, text string) Cue {
	return Cue{Start: time.Duration(fromMs) * time.Millisecond, End: time.Duration(toMs) * time.Millisecond, Text: text}
}

func TestParseJSONSurvivesWhatWhisperWrites(t *testing.T) {
	// A raw tab inside a string and a UTF-8 sequence cut in half by -ml.
	raw := []byte("{\"result\": {\"language\": \"EN\"},\n\"transcription\": [\n" +
		"{\"offsets\": {\"from\": 0, \"to\": 2500}, \"text\": \" Hello\tthere\"},\n" +
		"{\"offsets\": {\"from\": 2500, \"to\": 4000}, \"text\": \" caf\xc3\"}\n]}")
	res, err := ParseJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if res.Language != "en" || len(res.Cues) != 2 {
		t.Fatalf("got %+v", res)
	}
	if res.Cues[0].End != 2500*time.Millisecond || res.Cues[0].Text != " Hello there" {
		t.Fatalf("first cue %+v", res.Cues[0])
	}
}

func TestCleanDropsWhatIsNotSpeech(t *testing.T) {
	got, err := Clean([]Cue{
		cue(0, 1000, " [Music]"),
		cue(1000, 2000, " ♪ ♪"),
		cue(2000, 4000, " Welcome back to the channel."),
		cue(4000, 5000, " (upbeat music)"),
		cue(5000, 7000, " Subtitles by the Amara.org community"),
		cue(7000, 7000, " zero length"),
		cue(8000, 9000, " ♪ Today we cook rice ♪"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Text != "Welcome back to the channel." || got[1].Text != "Today we cook rice" {
		t.Fatalf("got %+v", got)
	}
}

func TestCleanCutsALoopButKeepsAChorus(t *testing.T) {
	in := []Cue{}
	for i := 0; i < 4; i++ {
		in = append(in, cue(i*1000, i*1000+900, "Con calma, yo quiero ver como lo mueve"))
	}
	in = append(in, cue(4000, 5000, "Next line."))
	for i := 0; i < 20; i++ {
		in = append(in, cue(5000+i*1000, 6000+i*1000, " Thank you so much for watching"))
	}
	got, err := Clean(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 9 {
		t.Fatalf("want the chorus 4 times, the next line, and the loop cut to 4; got %d cues: %+v", len(got), got)
	}
}

func TestCleanDropsWhatAnInstrumentalMakes(t *testing.T) {
	// What whisper wrote for 40s of music with nobody singing.
	junk := " " + strings.Repeat("ᵗ ", 70)
	run := " " + strings.Repeat("ని", 40) // the same, with no spaces
	got, err := Clean([]Cue{cue(0, 30000, junk), cue(30000, 40000, " ."), cue(40000, 41000, run), cue(41000, 44000, " La la la, here we go again")})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Text != "La la la, here we go again" {
		t.Fatalf("got %+v", got)
	}
}

func TestCleanWantsEnoughSpeech(t *testing.T) {
	if _, err := Clean([]Cue{cue(0, 1000, "[Music]"), cue(1000, 2000, " Hi.")}); !errors.Is(err, ErrNoSpeech) {
		t.Fatalf("err = %v, want ErrNoSpeech", err)
	}
}

func TestChunkMakesReadableCaptions(t *testing.T) {
	// What whisper really returned for the test clip: a sentence split across
	// two segments, then a short tail.
	got := Chunk([]Cue{
		cue(3070, 9240, " Welcome back to the channel, today we are testing automatic captions on memories."),
		cue(9240, 14340, " The server listens to the video once, writes down every word, and the captions show up"),
		cue(14340, 16010, " in the player."),
		cue(19500, 20000, " Bye."),
	})
	var texts []string
	for i, c := range got {
		texts = append(texts, c.Text)
		if n := len([]rune(c.Text)); n > maxCueChars {
			t.Fatalf("cue %d is %d chars: %q", i, n, c.Text)
		}
		if c.End-c.Start < minCueShow {
			t.Fatalf("cue %d only shows for %s", i, c.End-c.Start)
		}
		if i > 0 && c.Start < got[i-1].End {
			t.Fatalf("cue %d overlaps the one before", i)
		}
	}
	want := []string{
		"Welcome back to the channel, today we are testing automatic captions on memories.",
		"The server listens to the video once, writes down every word,",
		"and the captions show up in the player.",
		"Bye.",
	}
	if strings.Join(texts, "|") != strings.Join(want, "|") {
		t.Fatalf("got\n%s", strings.Join(texts, "\n"))
	}
	if got[0].Start != 3070*time.Millisecond || got[2].End != 16010*time.Millisecond {
		t.Fatalf("timing drifted: %+v", got)
	}
}

func TestChunkSplitsTextWithoutSpaces(t *testing.T) {
	got := Chunk([]Cue{cue(0, 10000, strings.Repeat("字", 100))})
	if len(got) != 2 {
		t.Fatalf("got %d cues", len(got))
	}
	for _, c := range got {
		if strings.Contains(c.Text, " ") || len([]rune(c.Text)) > maxCueChars {
			t.Fatalf("bad cue %q", c.Text)
		}
	}
}

func TestVTT(t *testing.T) {
	lang, vtt, n, err := VTT(&Result{Language: "en", Cues: []Cue{
		cue(1500, 3250, " Hello <b>world</b>, this is a test."),
		cue(3723400, 3725000, " An hour in."),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if lang != "en" || n != 2 {
		t.Fatalf("lang=%q cues=%d", lang, n)
	}
	for _, want := range []string{"WEBVTT", "00:00:01.500 --> 00:00:03.250", "01:02:03.400 --> 01:02:05.000", "An <01:02:03.800>hour"} {
		if !strings.Contains(vtt, want) {
			t.Fatalf("missing %q in\n%s", want, vtt)
		}
	}
	if strings.Contains(vtt, "<b>") {
		t.Fatalf("other tags must be stripped:\n%s", vtt)
	}
	plain := regexp.MustCompile(`<[^>]*>`).ReplaceAllString(vtt, "")
	if !strings.Contains(plain, "An hour in.") || !strings.Contains(plain, "Hello world, this is a test.") {
		t.Fatalf("text without the word times reads wrong:\n%s", plain)
	}
}

// What whisper wrote, word by word, for the sync test clip: speech at 2.13s,
// then a 3.5s pause before "Before" at 9.45s. whisper stretches "today." to the
// next word's start, across the pause.
func syncWords() []Cue {
	w := func(from, to int, text string) Cue { return cue(from, to, " "+text) }
	return []Cue{
		w(2150, 2390, "Good"), w(2390, 2890, "morning"), w(2890, 3770, "everyone,"),
		w(3770, 4040, "thank"), w(4040, 4250, "you"), w(4250, 4460, "for"),
		w(4460, 4880, "coming"), w(4880, 9480, "today."),
		w(9480, 9940, "Before"), w(9940, 10090, "we"), w(10090, 10580, "start,"),
	}
}

func TestChunkKeepsEachWordsRealTime(t *testing.T) {
	got := Chunk(syncWords())
	if len(got) != 2 {
		t.Fatalf("want a line per sentence, got %d: %+v", len(got), got)
	}
	first, second := got[0], got[1]
	if first.Text != "Good morning everyone, thank you for coming today." || second.Text != "Before we start," {
		t.Fatalf("got %q / %q", first.Text, second.Text)
	}
	if first.Start != 2150*time.Millisecond || second.Start != 9480*time.Millisecond {
		t.Fatalf("lines start at %s and %s", first.Start, second.Start)
	}
	// The first line ends soon after "today." is said, not when the next one starts.
	if first.End > 6500*time.Millisecond {
		t.Fatalf("first line runs on into the pause until %s", first.End)
	}
	if len(first.Words) != 8 || first.Words[1].Start != 2390*time.Millisecond || first.Words[7].Start != 4880*time.Millisecond {
		t.Fatalf("word times lost: %+v", first.Words)
	}
}

func TestChunkBreaksAtAPauseWithoutPunctuation(t *testing.T) {
	w := func(from, to int, text string) Cue { return cue(from, to, " "+text) }
	got := Chunk([]Cue{
		w(1000, 1300, "so"), w(1300, 1600, "anyway"), w(1600, 6000, "yeah"),
		w(6000, 6300, "what"), w(6300, 6600, "now"),
	})
	if len(got) != 2 || got[1].Text != "what now" || got[1].Start != 6000*time.Millisecond {
		t.Fatalf("a 4s pause should start a new line: %+v", got)
	}
}

func TestVTTNeedsALanguage(t *testing.T) {
	for _, lang := range []string{"", "auto", "e", "en-US-x"} {
		if _, _, _, err := VTT(&Result{Language: lang, Cues: []Cue{cue(0, 2000, "Plenty of words spoken here.")}}); !errors.Is(err, ErrNoLanguage) {
			t.Fatalf("lang %q: err = %v", lang, err)
		}
	}
}

func TestParseJSONTakesWordStartsFromDTW(t *testing.T) {
	// -ojf output with -ml 1: whisper's own guess put "First" at 5.03s, right
	// where the line before ended; DTW has it at 7.60s.
	raw := []byte(`{"result": {"language": "en"}, "transcription": [
		{"offsets": {"from": 0, "to": 0}, "text": "", "tokens": [{"text": "[_BEG_]", "t_dtw": -1}]},
		{"offsets": {"from": 4150, "to": 5030}, "text": " scratch.", "tokens": [{"text": " scratch", "t_dtw": 446}, {"text": ".", "t_dtw": 518}, {"text": "[_TT_300]", "t_dtw": -1}]},
		{"offsets": {"from": 5030, "to": 6230}, "text": " First", "tokens": [{"text": " First", "t_dtw": 760}]},
		{"offsets": {"from": 6230, "to": 6500}, "text": " I", "tokens": [{"text": " I", "t_dtw": 784}]}
	]}`)
	res, err := ParseJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Cues) != 3 {
		t.Fatalf("the empty segment should be dropped: %+v", res.Cues)
	}
	ms := func(n int) time.Duration { return time.Duration(n) * time.Millisecond }
	if res.Cues[0].Start != ms(4310) || res.Cues[1].Start != ms(7450) || res.Cues[2].Start != ms(7690) {
		t.Fatalf("starts should be DTW less %s: %+v", dtwLead, res.Cues)
	}
	// "scratch." runs no longer than such a word takes, not on to "First".
	if res.Cues[0].End != ms(4310)+longestWord(len("scratch.")) || res.Cues[1].End != ms(7690) {
		t.Fatalf("ends: %+v", res.Cues)
	}
}

func TestDTWPresetFromModelName(t *testing.T) {
	for name, want := range map[string]string{
		"/opt/whisper/ggml-small-q5_1.bin": "small",
		"ggml-base.en.bin":                 "base.en",
		"ggml-large-v3-turbo-q5_0.bin":     "large.v3.turbo",
		"GGML-MEDIUM.EN-Q8_0.BIN":          "medium.en",
		"ggml-large-v3.bin":                "large.v3",
		"my-model.bin":                     "",
		"ggml-smallish.bin":                "",
		"ggml-silero-v6.2.0.bin":           "",
	} {
		if got := DTWPreset(name); got != want {
			t.Errorf("%s: %q, want %q", name, got, want)
		}
	}
}

func span(fromMs, toMs int) Span {
	return Span{Start: time.Duration(fromMs) * time.Millisecond, End: time.Duration(toMs) * time.Millisecond}
}

func TestVTTLabelsMusicNobodySpeaksOver(t *testing.T) {
	_, vtt, n, err := VTT(&Result{
		Language: "en",
		Cues:     []Cue{cue(4000, 9000, " I started with this right here."), cue(20000, 24000, " Then the bass comes in.")},
		// An intro, a beat under the talking, a break, then an outro with a
		// hiccup in the detector's labels.
		Music: []Span{span(0, 3800), span(8000, 20500), span(30000, 40000), span(40500, 50000), span(60000, 61000)},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"00:00:00.000 --> 00:00:03.700\n[Music]",
		"--> 00:00:19.700\n[Music]", // from 0.3 s after the line, which Chunk ends near 9 s
		"00:00:30.000 --> 00:00:50.000\n[Music]",
	} {
		if !strings.Contains(vtt, want) {
			t.Fatalf("missing %q in\n%s", want, vtt)
		}
	}
	if n != 5 || strings.Contains(vtt, "00:01:00.000") {
		t.Fatalf("want 2 lines and 3 labels, the 1s of music left out; got %d:\n%s", n, vtt)
	}
}

func TestVTTCaptionsAnInstrumentalAsMusic(t *testing.T) {
	lang, vtt, n, err := VTT(&Result{Language: "nn", Cues: []Cue{cue(0, 1000, " stra.")}, Music: []Span{span(500, 45000)}})
	if err != nil {
		t.Fatal(err)
	}
	if lang != "en" || n != 1 || !strings.Contains(vtt, "00:00:00.500 --> 00:00:45.000\n[Music]") {
		t.Fatalf("lang=%q n=%d\n%s", lang, n, vtt)
	}
	if _, _, _, err := VTT(&Result{Language: "en", Cues: []Cue{cue(0, 1000, " Hi.")}, Music: []Span{span(0, 5000)}}); !errors.Is(err, ErrNoSpeech) {
		t.Fatalf("5s of music alone isn't a track: err = %v", err)
	}
}

func TestDropLoopsKeepsFourRepeats(t *testing.T) {
	var words []Cue
	add := func(texts ...string) {
		for _, s := range texts {
			words = append(words, cue(len(words)*100, len(words)*100+100, " "+s))
		}
	}
	add("Look,", "look,", "look.")
	for i := 0; i < 18; i++ {
		add("rock", "out,")
	}
	add("back,", "back,", "back,", "back,", "back,", "back.", "Put", "it", "all", "together.")
	var got []string
	for _, w := range dropLoops(words) {
		got = append(got, strings.TrimSpace(w.Text))
	}
	want := "Look, look, look. rock out, rock out, rock out, rock out, back, back, back, back, Put it all together."
	if strings.Join(got, " ") != want {
		t.Fatalf("got  %s\nwant %s", strings.Join(got, " "), want)
	}
}

func TestKeepInOrderSpreadsWordsDTWPutBack(t *testing.T) {
	s := func(secs ...float64) []Cue {
		var out []Cue
		for _, x := range secs {
			out = append(out, Cue{Start: time.Duration(x * float64(time.Second)), Text: " w"})
		}
		return out
	}
	got := s(1, 2, 50, 3, 4, 0.5, 0.6, 6)
	keepInOrder(got)
	var at []string
	for _, w := range got {
		at = append(at, w.Start.String())
	}
	// 50 is a jump ahead and 0.5, 0.6 jumps back: all three follow the word
	// before them at a talking pace, and every start now only moves forward.
	if strings.Join(at, " ") != "1s 2s 2.25s 3s 4s 4.25s 4.5s 6s" {
		t.Fatalf("got %s", strings.Join(at, " "))
	}
	stacked := s(10, 11, 11, 11, 11, 13)
	keepInOrder(stacked)
	if stacked[1].Start != 11*time.Second || stacked[2].Start != 11250*time.Millisecond || stacked[4].Start != 11750*time.Millisecond {
		t.Fatalf("a line stacked on one moment should be spread out after its first word: %+v", stacked)
	}
	// Words DTW lost before a long pause stay with the word before it rather
	// than being strung out one at a time across the pause.
	paused := s(622, 622, 622, 622, 640)
	keepInOrder(paused)
	if paused[3].Start != 622750*time.Millisecond {
		t.Fatalf("got %+v", paused)
	}
	tail := s(1, 2, 3, 0.1, 0.2)
	keepInOrder(tail)
	if tail[3].Start != 3250*time.Millisecond || tail[4].Start != 3500*time.Millisecond {
		t.Fatalf("words after the last trusted one go %s apart: %+v", wordPace, tail)
	}
}

func TestVTTDropsOnlyMadeUpLinesWhereNobodyTalks(t *testing.T) {
	w := func(from, to int, text string) Cue { return cue(from, to, " "+text) }
	res := &Result{
		Language: "en",
		Cues: []Cue{
			w(1000, 1400, "Put"), w(1400, 1700, "it"), w(1700, 2000, "all"), w(2000, 2600, "together."),
			// Talking over the score: the detector calls it music, but it's real.
			w(60000, 60400, "Out"), w(60400, 60600, "of"), w(60600, 60800, "the"), w(60800, 61600, "devastation."),
			w(72500, 73000, "Thank"), w(73000, 73300, "you"), w(73300, 73500, "for"), w(73500, 74400, "watching!"),
		},
		Speech: []Span{span(900, 2700)},
		Music:  []Span{span(58000, 74400)},
	}
	_, vtt, _, err := VTT(res)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(vtt, "watching") || !strings.Contains(vtt, "devastation") || !strings.Contains(vtt, "[Music]") {
		t.Fatalf("only the line whisper makes up should go:\n%s", vtt)
	}
	res.Speech = nil
	if _, vtt, _, _ = VTT(res); !strings.Contains(vtt, "watching") {
		t.Fatalf("with no speech map nothing is dropped:\n%s", vtt)
	}
}

func TestJoinHangingStartsPullsAStrandedFirstWord(t *testing.T) {
	w := func(ms int, text string) Cue { return cue(ms, ms, " "+text) }
	words := []Cue{
		w(122000, "rushed."), w(125630, "How"), w(127930, "exactly"), w(128150, "would"),
		// An unpunctuated lyric line ending before a pause stays where it is.
		w(130000, "under"), w(130300, "the"), w(130600, "moon"), w(134000, "Next"), w(134300, "line"),
	}
	joinHangingStarts(words)
	if words[1].Start != 127930*time.Millisecond-wordPace {
		t.Fatalf("How should sit just before exactly: %s", words[1].Start)
	}
	if words[6].Start != 130600*time.Millisecond {
		t.Fatalf("moon moved to %s", words[6].Start)
	}
}
