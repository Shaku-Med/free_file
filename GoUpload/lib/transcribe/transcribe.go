// Package transcribe turns the speech in an upload into captions with
// whisper.cpp (whisper-cli), run as a local process. No network, no paid API.
// Off unless WHISPER_MODEL points at a model file.
package transcribe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"goupload/lib/captions"
)

type Config struct {
	Bin   string
	Model string
	// DTW names the model's attention heads whisper times words with (small,
	// base.en, large.v3 ...); it has to match the model.
	DTW     string
	Threads int
	// Nice is the CPU priority whisper runs at (0 to 19); captions are never
	// urgent, so by default they only get what encodes and playback leave.
	Nice int
	// MaxSeconds skips anything longer: on a small box hours of audio would
	// hold the captions queue for longer than the captions are worth.
	MaxSeconds float64
}

// FromEnv returns nil when auto captions are off (WHISPER_MODEL unset) and an
// error when they are asked for but something they need is missing.
func FromEnv() (*Config, error) {
	model := strings.TrimSpace(os.Getenv("WHISPER_MODEL"))
	if model == "" || model == "disabled" {
		return nil, nil
	}
	if !isFile(model) {
		return nil, fmt.Errorf("WHISPER_MODEL %q is not a readable file", model)
	}
	bin, err := exec.LookPath(envOr("WHISPER_BIN", "whisper-cli"))
	if err != nil {
		return nil, fmt.Errorf("whisper-cli not found: %w", err)
	}
	dtw := strings.TrimSpace(os.Getenv("WHISPER_DTW"))
	if dtw == "" {
		dtw = DTWPreset(model)
	}
	if !dtwPresets[dtw] {
		return nil, fmt.Errorf("can't tell which model %q is for word timing; set WHISPER_DTW", filepath.Base(model))
	}
	threads, err := envInt("CAPTIONS_THREADS", 2, 1, 16)
	if err != nil {
		return nil, err
	}
	nice, err := envInt("CAPTIONS_NICE", 19, 0, 19)
	if err != nil {
		return nil, err
	}
	maxSeconds, err := envInt("CAPTIONS_MAX_SECONDS", 3600, 60, 4*3600)
	if err != nil {
		return nil, err
	}
	return &Config{Bin: bin, Model: model, DTW: dtw, Threads: threads, Nice: nice, MaxSeconds: float64(maxSeconds)}, nil
}

var (
	dtwPresets = map[string]bool{
		"tiny": true, "tiny.en": true, "base": true, "base.en": true, "small": true, "small.en": true,
		"medium": true, "medium.en": true, "large.v1": true, "large.v2": true, "large.v3": true, "large.v3.turbo": true,
	}
	modelNameRe = regexp.MustCompile(`^ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3-turbo|large-v3)(\.en)?([-.]|$)`)
)

// DTWPreset reads the word timing preset off a model file named the way
// whisper.cpp publishes them (ggml-small-q5_1.bin is "small"), or "" if it can't.
func DTWPreset(model string) string {
	m := modelNameRe.FindStringSubmatch(strings.ToLower(filepath.Base(model)))
	if m == nil {
		return ""
	}
	return strings.ReplaceAll(m[1], "-", ".") + m[2]
}

type Cue struct {
	Start time.Duration
	End   time.Duration
	Text  string
	// Words carries when each word is said, once whisper's word segments have
	// been grouped into a caption line.
	Words []Word
}

type Word struct {
	Start time.Duration
	Text  string
	// Glued: written straight after the word before it, with no space (CJK).
	Glued bool
}

type Result struct {
	Language string
	Cues     []Cue
	// Music is where the audio is music, when known. Stretches of it nobody is
	// speaking or singing over get a [Music] line, as on YouTube.
	Music []Span
	// Speech is where someone is talking, when known. Only lines whisper is
	// known to make up ("Thank you for watching!") are dropped outside it:
	// talking over a score and rapping over a beat read as music to the
	// detector, so everything else stays. Left out for songs.
	Speech []Span
}

// Span is a stretch of the audio.
type Span struct {
	Start, End time.Duration
}

// Run transcribes audioPath, writing whisper's own output into workDir.
func (c *Config) Run(ctx context.Context, audioPath, workDir string, song bool) (*Result, error) {
	outBase := filepath.Join(workDir, "whisper")
	args := []string{
		"-m", c.Model,
		"-f", audioPath,
		"-l", "auto",
		"-t", strconv.Itoa(c.Threads),
		// One segment per word, so every word carries its own time.
		"-ml", "1", "-sow",
		// Word times from where the model was listening (DTW), not whisper's own
		// guess, which gave the first word after a pause the time the line before
		// ended, so whole lines showed up to two seconds early. DTW needs flash
		// attention off, which doubles the work; one candidate instead of five
		// wins that back. Its retries stay on: without them a sung verse over a
		// loud beat was skipped outright.
		"-dtw", c.DTW, "-nfa", "-bs", "1", "-bo", "1",
		// No [Music] / ♪ style tokens: those are what it invents over non speech.
		"-sns",
		"-ojf", "-of", outBase,
		"-np",
	}
	// Each 30 s window isn't led by the text before it: carried over, one "..."
	// turned a whole song into dots, and a chorus already written once got
	// skipped when it came round again.
	if song {
		args = append(args, "-mc", "0")
	} else {
		// Instead every window starts from a short prompt written normally,
		// which holds whisper to capitals and punctuation; four tokens is the
		// prompt and nothing more. It's two filler words, so a rare leak into
		// the captions still reads as speech; songs skip it, as whisper is
		// likelier to echo it over music.
		args = append(args, "-mc", "4", "--carry-initial-prompt", "--prompt", "Right, okay.")
	}
	name := c.Bin
	if c.Nice > 0 {
		if nice, err := exec.LookPath("nice"); err == nil {
			args = append([]string{"-n", strconv.Itoa(c.Nice), c.Bin}, args...)
			name = nice
		}
	}

	stderr := &tailBuffer{max: 2048}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("whisper-cli: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	raw, err := os.ReadFile(outBase + ".json")
	if err != nil {
		return nil, fmt.Errorf("whisper output: %w", err)
	}
	_ = os.Remove(outBase + ".json")
	return ParseJSON(raw)
}

type whisperJSON struct {
	Result struct {
		Language string `json:"language"`
	} `json:"result"`
	Transcription []struct {
		Offsets struct {
			From int64 `json:"from"`
			To   int64 `json:"to"`
		} `json:"offsets"`
		Text   string `json:"text"`
		Tokens []struct {
			Text string `json:"text"`
			// DTW time in hundredths of a second, -1 when there isn't one.
			DTW int64 `json:"t_dtw"`
		} `json:"tokens"`
	} `json:"transcription"`
}

// dtwLead is how far before its DTW time a word really starts: DTW lands about
// 0.15 s into the word, measured on clips with every word's start known.
const dtwLead = 150 * time.Millisecond

// ParseJSON reads whisper-cli's -oj or -ojf output, taking each word's start
// from DTW when the tokens carry it. whisper.cpp only escapes quotes and
// backslashes, so control characters and any broken UTF-8 are cleaned out
// before decoding.
func ParseJSON(raw []byte) (*Result, error) {
	raw = bytes.ToValidUTF8(raw, nil)
	raw = bytes.Map(func(r rune) rune {
		if r < 0x20 {
			return ' '
		}
		return r
	}, raw)
	var out whisperJSON
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("whisper json: %w", err)
	}
	res := &Result{Language: strings.ToLower(strings.TrimSpace(out.Result.Language))}
	timed := false
	for _, s := range out.Transcription {
		if strings.TrimSpace(s.Text) == "" {
			continue
		}
		c := Cue{
			Start: time.Duration(s.Offsets.From) * time.Millisecond,
			End:   time.Duration(s.Offsets.To) * time.Millisecond,
			Text:  s.Text,
		}
		for _, t := range s.Tokens {
			if strings.HasPrefix(t.Text, "[_") {
				continue // [_BEG_], [_TT_150] and the like
			}
			if t.DTW >= 0 {
				c.Start = max(time.Duration(t.DTW)*10*time.Millisecond-dtwLead, 0)
				timed = true
			}
			break
		}
		res.Cues = append(res.Cues, c)
	}
	if timed {
		keepInOrder(res.Cues)
		joinHangingStarts(res.Cues)
		// whisper's end times are the same guesses DTW replaced: a word now runs
		// until the next one starts, for no longer than it could take to say.
		for i := range res.Cues {
			c := &res.Cues[i]
			c.End = c.Start + longestWord(len([]rune(strings.TrimSpace(c.Text))))
			if i+1 < len(res.Cues) && res.Cues[i+1].Start > c.Start {
				c.End = min(c.End, res.Cues[i+1].Start)
			}
		}
	}
	return res, nil
}

const (
	// wordPace is the most words DTW couldn't place are set apart: an easy
	// talking pace.
	wordPace = 250 * time.Millisecond
	// A word this close after the one before is one DTW couldn't place: faster
	// than anyone talks or raps.
	tooClose = 60 * time.Millisecond
)

// joinHangingStarts moves a sentence's first word that DTW put seconds before
// the rest of it ("How" ... "exactly would this work?") to just before the
// word after it. Over a noisy track DTW does that, and the pause cut the word
// off into a line of its own. Only words that open a sentence and end in no
// punctuation themselves move, so the end of an unpunctuated lyric stays put.
func joinHangingStarts(words []Cue) {
	for i := len(words) - 2; i >= 0; i-- {
		text := strings.TrimSpace(words[i].Text)
		opens := i == 0 || endsWith(strings.TrimSpace(words[i-1].Text), ".?!…,;:。？！，、；")
		if opens && !endsWith(text, ".?!…,;:。？！，、；-") && words[i+1].Start-words[i].Start > pauseBreak {
			words[i].Start = words[i+1].Start - wordPace
		}
	}
}

// keepInOrder repairs DTW where it loses its place, as it can over a repeated
// chorus: jumping back, or stacking a whole line onto one moment. The longest
// run of words whose starts only move forward is trusted, less any word stacked
// on the one before it; the rest follow the trusted word before them at no
// slower than wordPace, so a pause after them stays a pause.
func keepInOrder(words []Cue) {
	n := len(words)
	if n == 0 {
		return
	}
	// Longest non decreasing run of starts, patience style.
	var tails []int
	prev := make([]int, n)
	for i := range words {
		j := sort.Search(len(tails), func(k int) bool { return words[tails[k]].Start > words[i].Start })
		prev[i] = -1
		if j > 0 {
			prev[i] = tails[j-1]
		}
		if j == len(tails) {
			tails = append(tails, i)
		} else {
			tails[j] = i
		}
	}
	trusted := make([]bool, n)
	for i := tails[len(tails)-1]; i >= 0; i = prev[i] {
		trusted[i] = true
	}
	for i := n - 1; i > 0; i-- {
		if d := words[i].Start - words[i-1].Start; d >= 0 && d < tooClose {
			trusted[i] = false
		}
	}
	last := -1
	for i := 0; i <= n; i++ {
		if i < n && !trusted[i] {
			continue
		}
		if gap := i - last; gap > 1 {
			var from, to time.Duration
			switch {
			case last >= 0 && i < n:
				from, to = words[last].Start, words[i].Start
			case last >= 0:
				from = words[last].Start
				to = from + time.Duration(gap)*wordPace
			default:
				to = words[i].Start
				from = max(to-time.Duration(gap)*wordPace, 0)
			}
			step := min((to-from)/time.Duration(gap), wordPace)
			for k := last + 1; k < i; k++ {
				words[k].Start = from + step*time.Duration(k-last)
			}
		}
		last = i
	}
}

var (
	ErrNoSpeech    = errors.New("no usable speech")
	ErrNoLanguage  = errors.New("no usable language")
	bracketedRe    = regexp.MustCompile(`\[[^\]]*\]|\([^)]*\)|\*[^*]*\*`)
	musicNotesRe   = regexp.MustCompile(`[♪♫♬♩]+`)
	spacesRe       = regexp.MustCompile(`\s+`)
	minSpeechChars = 10
	// A chorus can sing the same line a few times running; whisper stuck in a
	// loop repeats one dozens of times.
	maxRepeats = 4
)

// Clean drops what whisper makes up when nobody is talking: lines that are only
// a sound tag or music notes, subtitle credits it learned from its training
// data, and a line looping over and over. It returns ErrNoSpeech when too
// little real speech is left to be worth a caption track.
func Clean(cues []Cue) ([]Cue, error) {
	out := make([]Cue, 0, len(cues))
	var lastKey string
	repeats := 0
	letters := 0
	for _, c := range cues {
		text := strings.TrimSpace(spacesRe.ReplaceAllString(musicNotesRe.ReplaceAllString(c.Text, " "), " "))
		key := normalize(bracketedRe.ReplaceAllString(text, " "))
		if key == "" || strings.Contains(strings.ToLower(text), "amara.org") || stutters(text) {
			continue
		}
		if c.End <= c.Start || c.Start < 0 {
			continue
		}
		if key == lastKey {
			repeats++
			if repeats >= maxRepeats {
				continue
			}
		} else {
			lastKey, repeats = key, 0
		}
		letters += len([]rune(key))
		c.Text = text
		out = append(out, c)
	}
	if letters < minSpeechChars {
		return nil, ErrNoSpeech
	}
	return out, nil
}

// stutters reports a line that is one token over and over, which is what
// whisper writes across an instrumental with nobody singing, spaced out or
// as one run of the same letter or two.
func stutters(text string) bool {
	if key := []rune(normalize(text)); len(key) >= 12 {
		seen := map[rune]bool{}
		for _, r := range key {
			seen[r] = true
		}
		if len(seen) <= 3 {
			return true
		}
	}
	words := strings.Fields(text)
	if len(words) < 6 {
		return false
	}
	counts := map[string]int{}
	top := 0
	for _, w := range words {
		k := normalize(w)
		counts[k]++
		top = max(top, counts[k])
	}
	return top*10 >= len(words)*7
}

// maxPhraseRepeats: a phrase of up to maxLoopWords said more times in a row
// than this is whisper stuck in a loop, like "rock out" eighteen times in two
// seconds over a beat. Real repeats ("look, look, look") stay.
const (
	maxPhraseRepeats = 4
	maxLoopWords     = 4
)

// dropLoops cuts each run of a repeated phrase down to maxPhraseRepeats.
func dropLoops(words []Cue) []Cue {
	keys := make([]string, len(words))
	for i, w := range words {
		keys[i] = normalize(w.Text)
	}
	out := make([]Cue, 0, len(words))
	for i := 0; i < len(words); {
		phrase, runs := 1, 1
		for p := 1; p <= maxLoopWords && runs <= maxPhraseRepeats; p++ {
			phrase, runs = p, repeats(keys, i, p)
		}
		if runs > maxPhraseRepeats {
			out = append(out, words[i:i+phrase*maxPhraseRepeats]...)
			i += phrase * runs
			continue
		}
		out = append(out, words[i])
		i++
	}
	return out
}

// repeats counts how many times the p words at i are said again and again from there.
func repeats(keys []string, i, p int) int {
	if i+p > len(keys) {
		return 1
	}
	n := 1
	for next := i + p; next+p <= len(keys); next += p {
		for j := 0; j < p; j++ {
			if keys[next+j] != keys[i+j] {
				return n
			}
		}
		n++
	}
	return n
}

// normalize keeps only letters and digits, lowercased, for comparing lines.
func normalize(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

const (
	maxCueChars = 84 // two lines of a normal caption
	maxRunChars = 40 // pieces of text written without spaces (Chinese, Japanese, Thai)
	minCueChars = 16 // shorter than this, a sentence end doesn't close the cue
	pauseBreak  = time.Second
	minCueShow  = 1200 * time.Millisecond
)

type word struct {
	text       string
	start, end time.Duration
	glued      bool // no space before it
}

// longestWord is how long a word of n characters can plausibly take to say.
// whisper stretches a word's end to the next word's start, right across any
// pause after it, which would hide the pause a caption should break at.
func longestWord(n int) time.Duration {
	return 300*time.Millisecond + time.Duration(n)*110*time.Millisecond
}

// splitWords turns one whisper segment into words. Segments are single words
// now, so this mostly passes their own times through; a segment holding more
// (text without spaces, or an older whisper output) shares its time out by
// length.
func splitWords(c Cue) []word {
	var pieces []word
	for _, f := range strings.Fields(musicNotesRe.ReplaceAllString(c.Text, " ")) {
		r := []rune(f)
		for i := 0; i < len(r); i += maxRunChars {
			j := min(i+maxRunChars, len(r))
			pieces = append(pieces, word{text: string(r[i:j]), glued: i > 0})
		}
	}
	if len(pieces) == 0 {
		return nil
	}
	total := 0
	for _, p := range pieces {
		total += len([]rune(p.text)) + 1
	}
	span := int64(c.End - c.Start)
	pos := 0
	for i := range pieces {
		pieces[i].start = c.Start + time.Duration(span*int64(pos)/int64(total))
		pos += len([]rune(pieces[i].text)) + 1
		pieces[i].end = c.Start + time.Duration(span*int64(pos)/int64(total))
		if cap := pieces[i].start + longestWord(len([]rune(pieces[i].text))); pieces[i].end > cap {
			pieces[i].end = cap
		}
	}
	return pieces
}

func endsWith(s, marks string) bool {
	r := []rune(s)
	return len(r) > 0 && strings.ContainsRune(marks, r[len(r)-1])
}

// Chunk groups whisper's words into caption lines: closed at sentence ends and
// at pauses, at a comma once a line is getting long, never longer than two
// lines, and up long enough to read. Each line keeps when every word is said.
func Chunk(segments []Cue) []Cue {
	var out []Cue
	var cur strings.Builder
	var words []Word
	var curStart, curEnd, lastStart time.Duration
	curLen := 0
	flush := func() {
		if curLen > 0 {
			out = append(out, Cue{Start: curStart, End: curEnd, Text: cur.String(), Words: words})
		}
		cur.Reset()
		words = nil
		curLen = 0
	}
	last := ""
	for _, seg := range segments {
		for _, w := range splitWords(seg) {
			// Words come in order; never let one start before the one before it.
			w.start = max(w.start, lastStart)
			w.end = max(w.end, w.start)
			lastStart = w.start
			n := len([]rune(w.text))
			if curLen > 0 {
				switch {
				case curLen+1+n > maxCueChars,
					w.start-curEnd > pauseBreak,
					curLen >= minCueChars && endsWith(last, ".?!…。？！"),
					curLen >= maxCueChars*2/3 && endsWith(last, ",;:，、；"):
					flush()
				}
			}
			glued := w.glued
			if curLen == 0 {
				curStart = w.start
				glued = false
			} else if !glued {
				cur.WriteByte(' ')
				curLen++
			}
			cur.WriteString(w.text)
			words = append(words, Word{Start: w.start, Text: w.text, Glued: glued})
			curLen += n
			curEnd = w.end
			last = w.text
		}
	}
	flush()
	for i := range out {
		if out[i].End-out[i].Start >= minCueShow {
			continue
		}
		limit := out[i].Start + minCueShow
		if i+1 < len(out) && out[i+1].Start < limit {
			limit = out[i+1].Start
		}
		if limit > out[i].End {
			out[i].End = limit
		}
	}
	return out
}

const (
	musicLabel = "[Music]"
	// Music shorter than this between two lines isn't worth a label.
	minMusicCue = 2 * time.Second
	// Room left around speech, so a label never crowds the line next to it.
	musicMargin = 300 * time.Millisecond
	// Gaps this short in what the detector calls music are joined over.
	musicBridge = time.Second
	// With nothing said, a track of only [Music] lines needs this much music.
	minMusicOnly = 10 * time.Second
)

// speechSlack is how far outside the detected speech a line may sit and still
// count as spoken: both timings are a little loose at the edges.
const speechSlack = 500 * time.Millisecond

// madeUpLines are whole lines whisper writes over music and silence, learned
// from the endings of the videos it was trained on, as their letters only.
var madeUpLines = map[string]bool{
	"you": true, "bye": true, "byebye": true, "thanks": true, "thankyou": true,
	"thankyousomuch": true, "thankyouverymuch": true, "thanksforwatching": true,
	"thankyouforwatching": true, "thankyousomuchforwatching": true,
	"thankyouverymuchforwatching": true, "pleasesubscribe": true, "subscribe": true,
	"likeandsubscribe": true, "pleaselikeandsubscribe": true, "subscribetomychannel": true,
	"seeyounexttime": true, "seeyouinthenextvideo": true, "graciasporver": true,
	"ご視聴ありがとうございました": true, "시청해주셔서감사합니다": true, "谢谢观看": true,
}

// dropMadeUp drops those lines where the detector heard nobody talking. Without
// its speech map nothing is dropped.
func dropMadeUp(lines []Cue, speech []Span) []Cue {
	if len(speech) == 0 {
		return lines
	}
	out := lines[:0:0]
	for _, c := range lines {
		if madeUpLines[normalize(c.Text)] && !overlaps(c, speech) {
			continue
		}
		out = append(out, c)
	}
	return out
}

func overlaps(c Cue, spans []Span) bool {
	for _, s := range spans {
		if c.Start < s.End+speechSlack && c.End > s.Start-speechSlack {
			return true
		}
	}
	return false
}

// musicCues labels the music nobody speaks or sings over, as YouTube does.
func musicCues(music []Span, speech []Cue) []Cue {
	spans := append([]Span(nil), music...)
	sort.Slice(spans, func(i, j int) bool { return spans[i].Start < spans[j].Start })
	var merged []Span
	for _, s := range spans {
		if s.End <= s.Start {
			continue
		}
		if n := len(merged); n > 0 && s.Start-merged[n-1].End <= musicBridge {
			merged[n-1].End = max(merged[n-1].End, s.End)
			continue
		}
		merged = append(merged, s)
	}
	var out []Cue
	for _, m := range merged {
		start := m.Start
		emit := func(end time.Duration) {
			if end-start >= minMusicCue {
				out = append(out, Cue{Start: start, End: end, Text: musicLabel})
			}
		}
		for _, c := range speech {
			if c.End+musicMargin <= start || c.Start-musicMargin >= m.End {
				continue
			}
			emit(c.Start - musicMargin)
			start = max(start, c.End+musicMargin)
		}
		emit(m.End)
	}
	return out
}

// VTT groups the result into lines, cleans them, labels music nobody is
// speaking over, and writes WebVTT through the same sanitizer owner uploaded
// captions go through. Every word after the first in a line is preceded by its
// own timestamp tag, as in YouTube's auto captions, so the player can show
// each word as it's said.
func VTT(res *Result) (lang, vtt string, cues int, err error) {
	lang = res.Language
	knownLang := len(lang) >= 2 && len(lang) <= 3 && captions.IsValidLanguageCode(lang)
	cleaned, err := Clean(Chunk(dropLoops(res.Cues)))
	if err == nil {
		if cleaned = dropMadeUp(cleaned, res.Speech); len(cleaned) == 0 {
			err = ErrNoSpeech
		}
	}
	switch {
	case errors.Is(err, ErrNoSpeech):
		// Nothing said, so only music can make a track, and its language is the
		// label's: whisper's guess for an instrumental means nothing.
		music := musicCues(res.Music, nil)
		var total time.Duration
		for _, m := range music {
			total += m.End - m.Start
		}
		if total < minMusicOnly {
			return "", "", 0, err
		}
		lang, cleaned = "en", music
	case err != nil:
		return "", "", 0, err
	case !knownLang:
		return "", "", 0, ErrNoLanguage
	default:
		cleaned = append(cleaned, musicCues(res.Music, cleaned)...)
		sort.SliceStable(cleaned, func(i, j int) bool { return cleaned[i].Start < cleaned[j].Start })
	}
	var b strings.Builder
	b.WriteString("WEBVTT\n\n")
	for _, c := range cleaned {
		b.WriteString(timestamp(c.Start))
		b.WriteString(" --> ")
		b.WriteString(timestamp(c.End))
		b.WriteByte('\n')
		if len(c.Words) == 0 {
			b.WriteString(c.Text)
		}
		for i, w := range c.Words {
			if i > 0 {
				if !w.Glued {
					b.WriteByte(' ')
				}
				b.WriteString("<" + timestamp(min(max(w.Start, c.Start), c.End)) + ">")
			}
			b.WriteString(w.Text)
		}
		b.WriteString("\n\n")
	}
	vtt, cues, err = captions.Sanitize([]byte(b.String()))
	return lang, vtt, cues, err
}

func timestamp(d time.Duration) string {
	ms := d.Milliseconds()
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3600000, ms/60000%60, ms/1000%60, ms%1000)
}

// tailBuffer keeps the last max bytes written, for error messages.
type tailBuffer struct {
	buf []byte
	max int
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.buf = append(t.buf, p...)
	if len(t.buf) > t.max {
		t.buf = t.buf[len(t.buf)-t.max:]
	}
	return len(p), nil
}

func (t *tailBuffer) String() string { return string(t.buf) }

// isFile reports a regular file this process can actually read: whisper runs as
// the same user and only says "not found" when it can't open a model.
func isFile(path string) bool {
	st, err := os.Stat(path)
	if err != nil || !st.Mode().IsRegular() {
		return false
	}
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envInt(key string, def, min, max int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return 0, fmt.Errorf("%s must be a whole number from %d to %d, got %q", key, min, max, raw)
	}
	return n, nil
}
