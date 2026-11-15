package transcribe

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"goupload/lib/ffmpeg"
)

// whisper only listens to the first 30 seconds to pick a language, so a video
// that opens with music or with a guest talking in another language got the
// wrong one for all of it. The language is now told from short probes spread
// over where people talk. When they agree, whisper is held to that language;
// when they don't, every stretch of the video is probed and each language's
// stretches are transcribed in it.

const (
	// Telling a language always runs the encoder over a full 30 s (a shorter
	// clip is padded, and -ac isn't applied to detection), so a probe uses all
	// of it.
	probeLength = 30 * time.Second
	maxProbes   = 6
	probeEvery  = time.Minute
	// Below this whisper is guessing. In testing speech scored 0.999, an
	// instrumental intro 0.74 and a probe half English, half French 0.73.
	minProbeP = 0.8
	// Mixed language videos are split into stretches about this long, cut in
	// pauses, and each is probed on its own.
	windowLength   = 30 * time.Second
	minWindow      = 10 * time.Second
	maxWindowProbe = 80
	minPauseCut    = 300 * time.Millisecond
	minProbeSpeech = 3 * time.Second
)

type probe struct {
	lang string
	p    float64
}

var detectedRe = regexp.MustCompile(`auto-detected language: ([a-z]{2,3}) \(p = ([0-9.]+)\)`)

// region is a stretch of the audio and the language it's transcribed in, ""
// to let whisper pick.
type region struct {
	Span
	lang string
}

// plan decides what language each part of the audio is transcribed in.
func (c *Config) plan(ctx context.Context, audioPath, workDir string, duration time.Duration, speech []Span) ([]region, error) {
	whole := []region{{Span: Span{0, duration}}}
	if duration <= 0 {
		return whole, nil
	}
	timeline := speechTimeline(duration, speech)
	var talked time.Duration
	for _, s := range timeline {
		talked += s.End - s.Start
	}
	n := min(max(int(math.Ceil(float64(talked)/float64(probeEvery))), 1), maxProbes)
	var spans []Span
	for _, t := range probePoints(timeline, n) {
		spans = append(spans, around(t, probeLength, duration))
	}
	probes, err := c.detect(ctx, audioPath, workDir, "probe", spans)
	if err != nil {
		return nil, err
	}
	langs := confidentLangs(probes)
	switch len(langs) {
	case 0:
		return whole, nil
	case 1:
		whole[0].lang = langs[0]
		return whole, nil
	}

	windows := windowsAt(duration, speech)
	if len(windows) > maxWindowProbe {
		whole[0].lang = majority(probes)
		return whole, nil
	}
	spans = spans[:0]
	for _, w := range windows {
		mid := w.Start + (w.End-w.Start)/2
		spans = append(spans, around(mid, probeLength, w.End).clampFrom(w.Start))
	}
	labels, err := c.detect(ctx, audioPath, workDir, "window", spans)
	if err != nil {
		return nil, err
	}
	return regions(windows, labels, majority(probes)), nil
}

// detect runs whisper's language detection on each span of the audio, all in
// one process so the model loads once.
func (c *Config) detect(ctx context.Context, audioPath, workDir, name string, spans []Span) ([]probe, error) {
	args := []string{"-m", c.Model, "-dl", "-t", strconv.Itoa(c.Threads)}
	for i, s := range spans {
		clip := filepath.Join(workDir, fmt.Sprintf("%s%03d.wav", name, i))
		if err := ffmpeg.CutSpeechAudio(ctx, audioPath, clip, s.Start, s.End-s.Start); err != nil {
			return nil, err
		}
		defer os.Remove(clip)
		args = append(args, "-f", clip)
	}
	out := &tailBuffer{max: 64 << 10}
	cmd := c.command(ctx, args)
	cmd.Stderr = out
	cmd.Stdout = out
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("whisper language detection: %w", err)
	}
	found := detectedRe.FindAllStringSubmatch(out.String(), -1)
	if len(found) != len(spans) {
		return nil, fmt.Errorf("whisper language detection: %d answers for %d clips", len(found), len(spans))
	}
	probes := make([]probe, len(found))
	for i, m := range found {
		p, _ := strconv.ParseFloat(m[2], 64)
		probes[i] = probe{lang: m[1], p: p}
	}
	return probes, nil
}

// speechTimeline is where people talk, merged and inside the audio, or the
// whole audio when that isn't known or is too little to go on.
func speechTimeline(duration time.Duration, speech []Span) []Span {
	sorted := make([]Span, 0, len(speech))
	for _, s := range speech {
		s.Start, s.End = max(s.Start, 0), min(s.End, duration)
		if s.End > s.Start {
			sorted = append(sorted, s)
		}
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Start < sorted[j].Start })
	var merged []Span
	var total time.Duration
	for _, s := range sorted {
		if n := len(merged); n > 0 && s.Start <= merged[n-1].End {
			if s.End > merged[n-1].End {
				total += s.End - merged[n-1].End
				merged[n-1].End = s.End
			}
			continue
		}
		merged = append(merged, s)
		total += s.End - s.Start
	}
	if total < minProbeSpeech {
		return []Span{{0, duration}}
	}
	return merged
}

// probePoints spreads n points evenly over the talking in timeline.
func probePoints(timeline []Span, n int) []time.Duration {
	var total time.Duration
	for _, s := range timeline {
		total += s.End - s.Start
	}
	points := make([]time.Duration, 0, n)
	for k := 0; k < n; k++ {
		want := time.Duration(float64(total) * (float64(2*k+1) / float64(2*n)))
		for _, s := range timeline {
			if l := s.End - s.Start; want > l {
				want -= l
				continue
			}
			points = append(points, s.Start+want)
			break
		}
	}
	return points
}

// around is length of audio centred on t, moved to stay inside [0, end).
func around(t, length, end time.Duration) Span {
	s := Span{Start: t - length/2, End: t + length/2}
	if s.Start < 0 {
		s.End -= s.Start
		s.Start = 0
	}
	if s.End > end {
		s.Start = max(s.Start-(s.End-end), 0)
		s.End = end
	}
	return s
}

func (s Span) clampFrom(start time.Duration) Span {
	if s.Start < start {
		s.Start = start
	}
	return s
}

// windowsAt cuts the audio into stretches of about windowLength, each ending
// in a pause between two bits of speech when one is near.
func windowsAt(duration time.Duration, speech []Span) []Span {
	var cuts []time.Duration
	timeline := speechTimeline(duration, speech)
	for i := 1; i < len(timeline); i++ {
		if gap := timeline[i].Start - timeline[i-1].End; gap >= minPauseCut {
			cuts = append(cuts, timeline[i-1].End+gap/2)
		}
	}
	var out []Span
	start := time.Duration(0)
	for duration-start > windowLength+minWindow {
		end := start + windowLength
		best := time.Duration(-1)
		for _, c := range cuts {
			if c-start >= minWindow && c-start <= windowLength {
				best = c
			}
		}
		if best < 0 {
			for _, c := range cuts {
				if c-start > windowLength && c-start <= 2*windowLength {
					best = c
					break
				}
			}
		}
		if best > 0 {
			end = best
		}
		out = append(out, Span{start, end})
		start = end
	}
	return append(out, Span{start, duration})
}

// confidentLangs lists the languages whisper was sure of in any probe.
func confidentLangs(probes []probe) []string {
	seen := map[string]bool{}
	var out []string
	for _, p := range probes {
		if p.p >= minProbeP && !seen[p.lang] {
			seen[p.lang] = true
			out = append(out, p.lang)
		}
	}
	return out
}

// majority is the language most probes were sure of, the first found on a tie.
func majority(probes []probe) string {
	count := map[string]int{}
	best := ""
	for _, p := range probes {
		if p.p < minProbeP {
			continue
		}
		count[p.lang]++
		if best == "" || count[p.lang] > count[best] {
			best = p.lang
		}
	}
	return best
}

// regions joins windows of the same language. A window whisper wasn't sure of
// (music, a pause) goes with the one before it, or the first sure one when it
// opens the video.
func regions(windows []Span, labels []probe, fallback string) []region {
	langs := make([]string, len(windows))
	last := ""
	for i := range windows {
		if labels[i].p >= minProbeP {
			last = labels[i].lang
		}
		langs[i] = last
	}
	next := fallback
	for i := len(windows) - 1; i >= 0; i-- {
		if langs[i] != "" {
			next = langs[i]
		} else {
			langs[i] = next
		}
	}
	var out []region
	for i, w := range windows {
		if n := len(out); n > 0 && out[n-1].lang == langs[i] {
			out[n-1].End = w.End
			continue
		}
		out = append(out, region{Span: w, lang: langs[i]})
	}
	return out
}

// prompt is a short line written the way someone of that language starts
// talking, which holds whisper to its capitals and punctuation. It only works
// in the audio's own language: French under an English prompt came out all
// lower case with no punctuation, the same as with none.
//
// tokens is its length in the multilingual models' tokenizer. whisper keeps
// the last max context - 1 prompt tokens and fills what's left with text from
// the window before, so the max context is set one past the prompt: all of it
// goes in and nothing carries over.
type prompt struct {
	text   string
	tokens int
}

var prompts = map[string]prompt{
	"en": {"Right, okay.", 4},
	"fr": {"Bon, d'accord.", 6},
	"es": {"Bueno, está bien.", 7},
	"pt": {"Bom, tudo bem.", 6},
	"de": {"Also, gut.", 5},
	"it": {"Allora, va bene.", 6},
	"nl": {"Nou, oké.", 6},
	"pl": {"No, dobrze.", 4},
	"ru": {"Ну, ладно.", 4},
	"uk": {"Ну, добре.", 5},
	"tr": {"Peki, tamam.", 5},
	"ar": {"حسنًا، طيب.", 10},
	"hi": {"अच्छा, ठीक है।", 17},
	"ja": {"はい、では。", 4},
	"zh": {"好的，那么。", 6},
	"ko": {"네, 그럼.", 4},
	"id": {"Oke, baiklah.", 6},
	"vi": {"Vâng, được rồi.", 11},
}

// promptFor is the prompt for lang. "auto", when the probes couldn't tell,
// keeps the English one captions have always had.
func promptFor(lang string) (prompt, bool) {
	lang = strings.ToLower(lang)
	if lang == "auto" {
		lang = "en"
	}
	p, ok := prompts[lang]
	return p, ok
}
