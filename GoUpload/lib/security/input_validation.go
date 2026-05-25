package security

import (
	"errors"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// SanitizeString removes null bytes, limits length, and trims. Use to prevent injection and DoS.
func SanitizeString(input string, maxLength int) string {
	if maxLength <= 0 {
		maxLength = 1000
	}
	s := strings.ReplaceAll(input, "\x00", "")
	if len(s) > maxLength {
		s = s[:maxLength]
	}
	return strings.TrimSpace(s)
}

// SanitizeSearchQuery sanitizes a search string and removes characters dangerous for SQL/NoSQL.
func SanitizeSearchQuery(query string) string {
	s := SanitizeString(query, 200)
	dangerous := regexp.MustCompile(`[<>'"` + "`" + `;\\]`)
	return dangerous.ReplaceAllString(s, "")
}

var uuidRegex = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// IsValidUUID returns true if id matches a UUID v4 format.
func IsValidUUID(id string) bool {
	return uuidRegex.MatchString(id)
}

var fileIDRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

// IsValidFileID returns true for UUIDs or alphanumeric IDs with dashes/underscores, max 100 chars.
func IsValidFileId(id string) bool {
	return fileIDRegex.MatchString(id)
}

// SanitizeFilePath removes path traversal and dangerous characters. Returns empty string if invalid.
func SanitizeFilePath(path string) string {
	s := strings.ReplaceAll(path, "\x00", "")
	s = strings.ReplaceAll(s, "..", "")
	s = strings.ReplaceAll(s, "/..", "")
	s = strings.ReplaceAll(s, "../", "")
	s = strings.Trim(s, "/")
	if len(s) > 500 {
		return ""
	}
	dangerous := regexp.MustCompile(`[\x00-\x1F\x7F<>'"` + "`" + `;\\|&$!*?{}]`)
	if dangerous.MatchString(s) {
		return ""
	}
	return s
}

// ValidateInteger parses value (string or int) and ensures it's in [min, max]. Returns 0, false if invalid.
func ValidateInteger(value interface{}, min, max int) (int, bool) {
	var n int64
	switch v := value.(type) {
	case string:
		var err error
		n, err = strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0, false
		}
	case int:
		n = int64(v)
	case int64:
		n = v
	default:
		return 0, false
	}
	if n < int64(min) || n > int64(max) {
		return 0, false
	}
	return int(n), true
}

// ValidatePagination validates page and limit. Returns (0,0), false if invalid.
func ValidatePagination(page, limit interface{}, maxLimit int) (p, l int, ok bool) {
	if maxLimit <= 0 {
		maxLimit = 100
	}
	p, ok1 := ValidateInteger(page, 1, 1000)
	l, ok2 := ValidateInteger(limit, 1, maxLimit)
	if !ok1 || !ok2 {
		return 0, 0, false
	}
	return p, l, true
}

// RE2 has no lookahead; (?s) makes . match newlines  strip script blocks in one pass.
var scriptTagRegex = regexp.MustCompile(`(?is)<script\b[^>]*>[\s\S]*?</script>`)
var onHandlerRegex = regexp.MustCompile(`(?i)on\w+\s*=`)
var jsProtoRegex = regexp.MustCompile(`(?i)javascript:`)

// SanitizeCommentContent strips scripts, event handlers, and javascript: from content.
func SanitizeCommentContent(content string, maxLength int) string {
	if maxLength <= 0 {
		maxLength = 5000
	}
	s := SanitizeString(content, maxLength)
	s = scriptTagRegex.ReplaceAllString(s, "")
	s = onHandlerRegex.ReplaceAllString(s, "")
	s = jsProtoRegex.ReplaceAllString(s, "")
	return s
}

var emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// IsValidEmail performs a basic email format check and length <= 254.
func IsValidEmail(email string) bool {
	return email != "" && len(email) <= 254 && emailRegex.MatchString(email)
}

var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,30}$`)

// IsValidUsername checks 3–30 chars, alphanumeric, underscores, hyphens.
func IsValidUsername(username string) bool {
	return usernameRegex.MatchString(username)
}

// SafeUploadFilename validates a client-supplied filename for disk storage and for passing to
// external tools via exec.Command argv.
//
// Go's exec.Command does not invoke /bin/sh  arguments are passed as an array, so characters
// like ;|&$ are not interpreted as shell syntax. This still rejects path separators and
// traversal-like names so filepath.Join(outputDir, userID, uploadID+"_"+name) cannot escape
// the intended directory, and strips risky patterns for safer logs and future refactors.
func SafeUploadFilename(name string) (string, error) {
	s := strings.TrimSpace(name)
	if s == "" {
		return "", errors.New("empty filename")
	}
	if filepath.Base(s) != s {
		return "", errors.New("path not allowed in filename")
	}
	switch s {
	case ".", "..":
		return "", errors.New("invalid filename")
	}
	if strings.HasPrefix(s, "-") {
		return "", errors.New("filename cannot start with hyphen")
	}
	for _, r := range s {
		if r < 32 || r == 127 {
			return "", errors.New("invalid character in filename")
		}
	}
	// Shell metacharacters (harmless with argv-only exec; reject for defense in depth).
	if strings.ContainsAny(s, ";|&$\n\r`") {
		return "", errors.New("invalid character in filename")
	}
	if len(s) > 220 {
		return "", errors.New("filename too long")
	}
	ext := filepath.Ext(s)
	if ext == "" || len(ext) < 2 {
		return "", errors.New("missing extension")
	}
	if strings.TrimSuffix(s, ext) == "" {
		return "", errors.New("invalid filename")
	}
	return s, nil
}
