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
	"strconv"
	"strings"
	"time"
	"unicode"

	"goupload/lib/captions"
)

type Config struct {
	Bin      string
	Model    string
	VADModel string
	Threads  int
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
	vad := strings.TrimSpace(os.Getenv("WHISPER_VAD_MODEL"))
	if vad != "" && !isFile(vad) {
		return nil, fmt.Errorf("WHISPER_VAD_MODEL %q is not a readable file", vad)
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
	return &Config{Bin: bin, Model: model, VADModel: vad, Threads: threads, Nice: nice, MaxSeconds: float64(maxSeconds)}, nil
}

type Cue struct {
	Start time.Duration
	End   time.Duration
	Text  string
}

type Result struct {
	Language string
	Cues     []Cue
}

// Run transcribes audioPath, writing whisper's own output into workDir.
func (c *Config) Run(ctx context.Context, audioPath, workDir string) (*Result, error) {
	outBase := filepath.Join(workDir, "whisper")
	args := []string{
		"-m", c.Model,
		"-f", audioPath,
		"-l", "auto",
		"-t", strconv.Itoa(c.Threads),
		// No [Music] / ♪ style tokens: those are what it invents over non speech.
		"-sns",
		"-oj", "-of", outBase,
		"-np",
	}
	if c.VADModel != "" {
		args = append(args, "--vad", "-vm", c.VADModel)
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
		Text string `json:"text"`
	} `json:"transcription"`
}

// ParseJSON reads whisper-cli's -oj output. whisper.cpp only escapes quotes and
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
	for _, s := range out.Transcription {
		res.Cues = append(res.Cues, Cue{
			Start: time.Duration(s.Offsets.From) * time.Millisecond,
			End:   time.Duration(s.Offsets.To) * time.Millisecond,
			Text:  s.Text,
		})
	}
	return res, nil
}

var (
	ErrNoSpeech    = errors.New("no usable speech")
	ErrNoLanguage  = errors.New("no usable language")
	bracketedRe    = regexp.MustCompile(`\[[^\]]*\]|\([^)]*\)|\*[^*]*\*`)
	musicNotesRe   = regexp.MustCompile(`[♪♫♬♩]+`)
	spacesRe       = regexp.MustCompile(`\s+`)
	minSpeechChars = 10
	maxRepeats     = 2
)

// Clean drops what whisper makes up when nobody is talking: cues that are only
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
		if key == "" || strings.Contains(strings.ToLower(text), "amara.org") {
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
		out = append(out, Cue{Start: c.Start, End: c.End, Text: text})
	}
	if letters < minSpeechChars {
		return nil, ErrNoSpeech
	}
	return out, nil
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

// splitWords spreads a segment's time over its words by length. whisper's own
// word timings can't be used: with VAD on they run on the trimmed audio's
// clock, not the video's.
func splitWords(c Cue) []word {
	var pieces []word
	for _, f := range strings.Fields(c.Text) {
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
	}
	return pieces
}

func endsWith(s, marks string) bool {
	r := []rune(s)
	return len(r) > 0 && strings.ContainsRune(marks, r[len(r)-1])
}

// Chunk turns whisper's segments, which can stop mid sentence and run past two
// lines, into captions: closed at sentence ends and pauses, at a comma once a
// line is getting long, never longer than two lines, and up long enough to read.
func Chunk(segments []Cue) []Cue {
	var out []Cue
	var cur strings.Builder
	var curStart, curEnd time.Duration
	curLen := 0
	flush := func() {
		if curLen > 0 {
			out = append(out, Cue{Start: curStart, End: curEnd, Text: cur.String()})
		}
		cur.Reset()
		curLen = 0
	}
	last := ""
	for _, seg := range segments {
		for _, w := range splitWords(seg) {
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
			if curLen == 0 {
				curStart = w.start
			} else if !w.glued {
				cur.WriteByte(' ')
				curLen++
			}
			cur.WriteString(w.text)
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

// VTT cleans the result and writes it as WebVTT, through the same sanitizer
// owner uploaded captions go through.
func VTT(res *Result) (lang, vtt string, cues int, err error) {
	lang = res.Language
	if len(lang) < 2 || len(lang) > 3 || !captions.IsValidLanguageCode(lang) {
		return "", "", 0, ErrNoLanguage
	}
	cleaned, err := Clean(res.Cues)
	if err != nil {
		return "", "", 0, err
	}
	var b strings.Builder
	b.WriteString("WEBVTT\n\n")
	for _, c := range Chunk(cleaned) {
		b.WriteString(timestamp(c.Start))
		b.WriteString(" --> ")
		b.WriteString(timestamp(c.End))
		b.WriteByte('\n')
		b.WriteString(c.Text)
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

func isFile(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.Mode().IsRegular()
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
