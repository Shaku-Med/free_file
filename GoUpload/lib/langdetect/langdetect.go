// Package langdetect guesses the language of a file's title/description so
// recommendations can keep same-language content together. Pure Go trigram
// detection (whatlanggo) - no network, no model files, microseconds per call.
package langdetect

import (
	"strings"

	"github.com/abadojack/whatlanggo"
)

// Trigram detection is unreliable on very short strings ("wow", "part 2"), and
// a wrong language tag is worse than none - below this many letters we return "".
const minLetters = 12

// whatlanggo's IsReliable() (confidence > 0.8) rejects half of correctly-detected
// title-length English/Spanish. Measured on realistic titles: correct detections
// score >= 0.44, junk ("Måneskin - Beggin'", band names) scores <= 0.10, so 0.4
// separates them cleanly.
const minConfidence = 0.4

// Detection quality saturates long before this; the cap also keeps a
// pathologically huge description from burning CPU in the trigram pass.
const maxChars = 4000

// Detect returns the ISO 639-3 code ("eng", "cmn", "spa") of the dominant
// language across the given text parts, or "" when there isn't enough signal
// to be confident. Callers treat "" as unknown and store NULL.
func Detect(parts ...string) string {
	text := strings.TrimSpace(strings.Join(parts, " "))
	if text == "" {
		return ""
	}
	if len(text) > maxChars {
		text = text[:maxChars]
	}

	letters := 0
	for _, r := range text {
		if !strings.ContainsRune(" \t\n0123456789.,!?#-_()[]{}|/\\:;'\"+&@%*=~", r) {
			letters++
		}
	}
	if letters < minLetters {
		return ""
	}

	info := whatlanggo.Detect(text)
	if info.Confidence < minConfidence {
		return ""
	}
	code := strings.ToLower(whatlanggo.LangToString(info.Lang))
	if len(code) < 2 || len(code) > 3 {
		return ""
	}
	return code
}
