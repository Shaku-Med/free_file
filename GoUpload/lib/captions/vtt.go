package captions

import (
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

// MaxVTTBytes is the upper bound on a single uploaded caption file. The app proxy
// enforces the same value; the Go server enforces it again so a compromised proxy
// or direct Go call still cannot store oversized content.
const MaxVTTBytes = 1 * 1024 * 1024

const MaxLanguageLen = 32

const MaxCueCount = 5000
const MaxCueTextLen = 1000

var bcp47Re = regexp.MustCompile(`^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$`)

func IsValidLanguageCode(code string) bool {
	c := strings.TrimSpace(code)
	if c == "" || len(c) > MaxLanguageLen {
		return false
	}
	return bcp47Re.MatchString(c)
}

var safeUniqueIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var safeDateFolderRe = regexp.MustCompile(`^\d{2}_\d{2}_\d{4}$`)
var safeGithubRepoRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)

func IsSafeUniqueID(s string) bool {
	return safeUniqueIDRe.MatchString(s)
}

func IsSafeDateFolder(s string) bool {
	return safeDateFolderRe.MatchString(s)
}

func IsSafeGithubRepo(s string) bool {
	return safeGithubRepoRe.MatchString(s)
}

var (
	ErrEmpty           = errors.New("empty file")
	ErrTooLarge        = errors.New("file too large")
	ErrNotUTF8         = errors.New("file is not valid UTF-8")
	ErrMissingHeader   = errors.New("missing WEBVTT header")
	ErrNoCues          = errors.New("no cues found")
	ErrTooManyCues     = errors.New("too many cues")
	ErrCueTooLong      = errors.New("cue text too long")
	ErrInvalidTimestamp = errors.New("invalid cue timestamp")
)

// htmlTagRe is intentionally greedy on `<...>`; we strip everything that looks
// like a tag (including <script>, <v Amy>, <c.classname>, etc.).
var htmlTagRe = regexp.MustCompile(`<[^>]*>`)

var entityRe = regexp.MustCompile(`&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);`)

var timestampRe = regexp.MustCompile(`^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$`)

// Sanitize parses and rewrites the VTT file so the bytes we store on GitHub
// contain no HTML tags, no control characters, and only valid cues.
//
// Returns the cleaned VTT text plus the cue count. Caller should reject if
// cueCount == 0.
func Sanitize(input []byte) (string, int, error) {
	if len(input) == 0 {
		return "", 0, ErrEmpty
	}
	if len(input) > MaxVTTBytes {
		return "", 0, ErrTooLarge
	}
	if !utf8.Valid(input) {
		return "", 0, ErrNotUTF8
	}

	src := string(input)
	src = strings.ReplaceAll(src, "\r\n", "\n")
	src = strings.ReplaceAll(src, "\r", "\n")
	if len(src) >= 3 && src[0] == 0xEF && src[1] == 0xBB && src[2] == 0xBF {
		src = src[3:]
	}

	blocks := splitBlocks(src)
	if len(blocks) == 0 {
		return "", 0, ErrNoCues
	}

	var out strings.Builder
	out.WriteString("WEBVTT\n\n")
	cueCount := 0

	for _, raw := range blocks {
		lines := strings.Split(raw, "\n")
		if len(lines) == 0 {
			continue
		}
		first := strings.TrimSpace(lines[0])
		if strings.HasPrefix(first, "WEBVTT") {
			continue
		}
		if strings.HasPrefix(first, "NOTE") || strings.HasPrefix(first, "STYLE") || strings.HasPrefix(first, "REGION") {
			continue
		}

		timingIdx := -1
		for i := 0; i < len(lines) && i < 2; i++ {
			if strings.Contains(lines[i], "-->") {
				timingIdx = i
				break
			}
		}
		if timingIdx < 0 {
			continue
		}

		timing := lines[timingIdx]
		arrow := strings.Index(timing, "-->")
		startStr := strings.TrimSpace(timing[:arrow])
		endPart := strings.Fields(strings.TrimSpace(timing[arrow+3:]))
		if len(endPart) == 0 {
			continue
		}
		endStr := endPart[0]
		if !timestampRe.MatchString(startStr) || !timestampRe.MatchString(endStr) {
			continue
		}
		if !timingMonotonic(startStr, endStr) {
			continue
		}

		textLines := lines[timingIdx+1:]
		joined := strings.Join(textLines, "\n")
		cleaned := sanitizeCueText(joined)
		if cleaned == "" {
			continue
		}
		if utf8.RuneCountInString(cleaned) > MaxCueTextLen {
			cleaned = truncateRunes(cleaned, MaxCueTextLen)
		}

		if cueCount >= MaxCueCount {
			break
		}
		cueCount++
		out.WriteString(itoaPadded(cueCount))
		out.WriteByte('\n')
		out.WriteString(startStr)
		out.WriteString(" --> ")
		out.WriteString(endStr)
		out.WriteByte('\n')
		out.WriteString(cleaned)
		out.WriteString("\n\n")
	}

	if cueCount == 0 {
		return "", 0, ErrNoCues
	}
	return out.String(), cueCount, nil
}

func splitBlocks(s string) []string {
	parts := strings.Split(s, "\n\n")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func timingMonotonic(start, end string) bool {
	return parseTimestamp(start) < parseTimestamp(end)
}

func parseTimestamp(s string) int64 {
	m := timestampRe.FindStringSubmatch(s)
	if m == nil {
		return -1
	}
	hh, mm, ss := 0, 0, 0
	ms := 0
	if m[1] != "" {
		hh = atoiSafe(m[1])
	}
	mm = atoiSafe(m[2])
	ss = atoiSafe(m[3])
	if m[4] != "" {
		raw := m[4]
		for len(raw) < 3 {
			raw += "0"
		}
		ms = atoiSafe(raw[:3])
	}
	if mm >= 60 || ss >= 60 {
		return -1
	}
	return int64(hh)*3600000 + int64(mm)*60000 + int64(ss)*1000 + int64(ms)
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return n
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func sanitizeCueText(s string) string {
	out := htmlTagRe.ReplaceAllString(s, "")
	out = entityRe.ReplaceAllStringFunc(out, decodeEntity)
	var b strings.Builder
	b.Grow(len(out))
	for _, r := range out {
		if r == '\n' || r == '\t' {
			b.WriteRune(r)
			continue
		}
		if r < 0x20 || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	collapsed := collapseWhitespace(b.String())
	return strings.TrimSpace(collapsed)
}

func decodeEntity(in string) string {
	switch in {
	case "&amp;":
		return "&"
	case "&lt;":
		return "<"
	case "&gt;":
		return ">"
	case "&quot;":
		return "\""
	case "&apos;":
		return "'"
	case "&nbsp;":
		return " "
	}
	return ""
}

func collapseWhitespace(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range s {
		if r == '\n' {
			b.WriteRune(r)
			prevSpace = false
			continue
		}
		if r == ' ' || r == '\t' {
			if !prevSpace {
				b.WriteRune(' ')
				prevSpace = true
			}
			continue
		}
		b.WriteRune(r)
		prevSpace = false
	}
	return b.String()
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	count := 0
	for i := range s {
		if count == n {
			return s[:i]
		}
		count++
	}
	return s
}

func itoaPadded(n int) string {
	if n <= 0 {
		return "0"
	}
	buf := make([]byte, 0, 8)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	return string(buf)
}
