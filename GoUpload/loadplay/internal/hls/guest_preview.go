package hls

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

const maxGuestPreviewSec = 10 * 60

// GuestPreviewSeconds mirrors app computeGuestPreviewSeconds.
func GuestPreviewSeconds(durationSec float64) int {
	if math.IsNaN(durationSec) || math.IsInf(durationSec, 0) || durationSec <= 0 {
		return 30
	}
	quarter := durationSec / 4
	capped := math.Min(maxGuestPreviewSec, quarter)
	return int(math.Max(30, math.Round(capped)))
}

func IsMasterPlaylist(content string) bool {
	return strings.Contains(content, "#EXT-X-STREAM-INF") ||
		strings.Contains(content, "#EXT-X-I-FRAME-STREAM-INF")
}

func IsMediaPlaylist(content string) bool {
	return strings.Contains(content, "#EXTINF:")
}

var (
	bandwidthRe  = regexp.MustCompile(`(?i)BANDWIDTH=(\d+)`)
	resolutionRe = regexp.MustCompile(`(?i)RESOLUTION=(\d+)x(\d+)`)
	extinfDurRe  = regexp.MustCompile(`^#EXTINF:([0-9.]+)`)
)

func variantQualityScore(streamInfLine string) int {
	if m := bandwidthRe.FindStringSubmatch(streamInfLine); len(m) == 2 {
		if v, err := strconv.Atoi(m[1]); err == nil {
			return v
		}
	}
	if m := resolutionRe.FindStringSubmatch(streamInfLine); len(m) == 3 {
		w, _ := strconv.Atoi(m[1])
		h, _ := strconv.Atoi(m[2])
		return w * h
	}
	return math.MaxInt
}

// RestrictMasterToLowestRendition keeps only the lowest BANDWIDTH / RESOLUTION variant.
func RestrictMasterToLowestRendition(content string) string {
	lines := splitLines(content)
	firstStream := -1
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "#EXT-X-STREAM-INF") {
			firstStream = i
			break
		}
	}
	if firstStream == -1 {
		return content
	}

	type variant struct {
		inf, uri int
		score    int
	}
	var vars []variant
	for i := firstStream; i < len(lines); {
		t := strings.TrimSpace(lines[i])
		if strings.HasPrefix(t, "#EXT-X-STREAM-INF") {
			score := variantQualityScore(lines[i])
			j := i + 1
			for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
				j++
			}
			if j >= len(lines) || strings.HasPrefix(strings.TrimSpace(lines[j]), "#") {
				i++
				continue
			}
			vars = append(vars, variant{inf: i, uri: j, score: score})
			i = j + 1
			continue
		}
		if strings.HasPrefix(t, "#EXT-X-I-FRAME-STREAM-INF") {
			j := i + 1
			for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
				j++
			}
			if j < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[j]), "#") {
				i = j + 1
			} else {
				i++
			}
			continue
		}
		i++
	}
	if len(vars) <= 1 {
		return content
	}
	best := vars[0]
	for _, v := range vars[1:] {
		if v.score < best.score {
			best = v
		}
	}
	out := append(append([]string{}, lines[:firstStream]...), lines[best.inf], lines[best.uri])
	body := strings.Join(out, "\n")
	if strings.HasSuffix(content, "\n") && !strings.HasSuffix(body, "\n") {
		body += "\n"
	}
	return body
}

// TruncateMediaPlaylistAtDuration drops EXTINF/URI pairs beyond maxSeconds.
func TruncateMediaPlaylistAtDuration(content string, maxSeconds int) string {
	if maxSeconds <= 0 {
		return content
	}
	lines := splitLines(content)
	firstExtinf := -1
	for i, line := range lines {
		if strings.HasPrefix(line, "#EXTINF:") {
			firstExtinf = i
			break
		}
	}
	if firstExtinf == -1 {
		return content
	}

	header := lines[:firstExtinf]
	var body []string
	accumulated := 0.0
	for i := firstExtinf; i < len(lines); i++ {
		line := lines[i]
		if !strings.HasPrefix(line, "#EXTINF:") {
			continue
		}
		m := extinfDurRe.FindStringSubmatch(line)
		dur := 0.0
		if len(m) == 2 {
			dur, _ = strconv.ParseFloat(m[1], 64)
		}
		if i+1 >= len(lines) {
			continue
		}
		uriLine := lines[i+1]
		if uriLine == "" || strings.HasPrefix(uriLine, "#") {
			continue
		}
		if accumulated >= float64(maxSeconds) {
			break
		}
		if accumulated+dur > float64(maxSeconds) {
			break
		}
		body = append(body, line, uriLine)
		accumulated += dur
		i++
	}
	if len(body) == 0 && firstExtinf+1 < len(lines) {
		line := lines[firstExtinf]
		uriLine := lines[firstExtinf+1]
		if strings.HasPrefix(line, "#EXTINF:") && uriLine != "" && !strings.HasPrefix(uriLine, "#") {
			body = []string{line, uriLine}
		}
	}
	if len(body) == 0 {
		return content
	}
	out := append(append([]string{}, header...), body...)
	hasEnd := false
	for _, l := range out {
		if strings.TrimSpace(l) == "#EXT-X-ENDLIST" {
			hasEnd = true
			break
		}
	}
	if !hasEnd {
		out = append(out, "#EXT-X-ENDLIST")
	}
	return strings.Join(out, "\n")
}

func splitLines(content string) []string {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	if content == "" {
		return nil
	}
	return strings.Split(content, "\n")
}
