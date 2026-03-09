package lib

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"
)

const MaxBodySize = 1 << 20 // 1MB

var safeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// DecodeJSON reads the request body with a size cap and decodes into dst.
// Does NOT reject unknown fields — MediaMTX webhooks may add new fields
// across versions and we need forward compatibility.
func DecodeJSON(r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, MaxBodySize)

	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}

// ReadBody reads the raw request body with the same size cap as DecodeJSON.
// Used for non-JSON payloads like SDP offers in WHIP/WHEP.
func ReadBody(r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(nil, r.Body, MaxBodySize)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if len(body) == 0 {
		return nil, fmt.Errorf("empty body")
	}
	return body, nil
}

func IsValidID(id string) bool {
	return len(id) > 0 && len(id) <= 128 && safeIDPattern.MatchString(id)
}

func SanitizeString(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\x00", "")
	if !utf8.ValidString(s) {
		return ""
	}
	return s
}
