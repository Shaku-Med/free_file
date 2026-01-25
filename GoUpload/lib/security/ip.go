package security

import (
	"net/http"
	"os"
	"regexp"
	"strings"
)

// VerifyIP returns false for "unknown" or if in production and the string is not a simple IPv4.
func VerifyIP(ip string) bool {
	if ip == "unknown" {
		return false
	}
	// Simple IPv4
	rx := regexp.MustCompile(`^(\d{1,3}\.){3}\d{1,3}$`)
	if !rx.MatchString(ip) && IsProd() {
		return false
	}
	return true
}

// IsProd returns true when APP_ENV is production or prod.
func IsProd() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	return v == "production" || v == "prod"
}

// IsDev returns true when APP_ENV is development or dev.
func IsDev() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	return v == "development" || v == "dev"
}

// HeaderGetter is a minimal interface for reading a header. *http.Request and adapters satisfy it.
type HeaderGetter interface {
	Get(key string) string
}

// GetClientIP extracts the client IP from common proxy headers. Uses first X-Forwarded-For if present.
func GetClientIP(h http.Header) string {
	headers := []string{
		"X-Real-IP", "Cf-Connecting-IP", "X-Client-IP", "Fastly-Client-IP",
		"True-Client-IP", "X-Forwarded-For", "X-Forwarded", "X-Cluster-Client-IP",
		"Forwarded-For", "Forwarded", "Via",
		"Do-Connecting-IP", "Oxygen-Buyer-IP", "Http-X-Forwarded-For", "Fly-Client-IP",
	}
	for _, name := range headers {
		v := h.Get(name)
		if v == "" {
			continue
		}
		if name == "X-Forwarded-For" {
			// use first hop
			parts := strings.Split(v, ",")
			if len(parts) > 0 {
				v = strings.TrimSpace(parts[0])
			}
		}
		if IsProd() && !VerifyIP(v) {
			return "unknown"
		}
		if IsDev() {
			return "::1"
		}
		return v
	}
	return "unknown"
}
