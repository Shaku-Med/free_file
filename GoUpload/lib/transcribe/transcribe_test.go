package transcribe

import (
	"errors"
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
	got, err := Clean([]Cue{cue(0, 30000, junk), cue(30000, 40000, " ."), cue(40000, 43000, " La la la, here we go again")})
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
	for _, want := range []string{"WEBVTT", "00:00:01.500 --> 00:00:03.250", "01:02:03.400 --> 01:02:05.000", "An hour in."} {
		if !strings.Contains(vtt, want) {
			t.Fatalf("missing %q in\n%s", want, vtt)
		}
	}
	if strings.Contains(vtt, "<b>") {
		t.Fatalf("tags must be stripped:\n%s", vtt)
	}
}

func TestVTTNeedsALanguage(t *testing.T) {
	for _, lang := range []string{"", "auto", "e", "en-US-x"} {
		if _, _, _, err := VTT(&Result{Language: lang, Cues: []Cue{cue(0, 2000, "Plenty of words spoken here.")}}); !errors.Is(err, ErrNoLanguage) {
			t.Fatalf("lang %q: err = %v", lang, err)
		}
	}
}
