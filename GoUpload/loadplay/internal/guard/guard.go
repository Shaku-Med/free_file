package guard

import (
	"net/url"
	"strings"
)

// Soft hot-link gate. Returns "" when the request looks legit, else a
// short reason string the caller can log. Token + HMAC are the real
// auth; this layer just cuts down on casual leeching.
type Config struct {
	AllowedOrigins []string
	BlockedOrigins []string
	BlockToolUA    bool
}

func NewConfig(originsCSV, blockedCSV string, blockToolUA bool) Config {
	return Config{
		AllowedOrigins: splitCSV(originsCSV),
		BlockedOrigins: splitCSV(blockedCSV),
		BlockToolUA:    blockToolUA,
	}
}

func splitCSV(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		p := strings.TrimSpace(part)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func (c Config) Check(origin, referer, userAgent string) string {
	if origin != "" {
		if c.IsBlockedHost(origin) {
			return "self-origin"
		}
		if !c.isAllowedHost(origin) {
			return "origin"
		}
	}
	if referer != "" {
		if c.IsBlockedHost(referer) {
			// HLS follow-up requests often carry a LoadPlay manifest URL as
			// Referer. Combined Origin checks happen in enforcePlaybackSecurity.
		} else if !c.isAllowedHost(referer) {
			return "referer"
		}
	}
	if c.BlockToolUA && looksLikeTool(userAgent) {
		return "tool-ua"
	}
	return ""
}

func (c Config) AllowsOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	if c.IsBlockedHost(origin) {
		return false
	}
	if len(c.AllowedOrigins) == 0 {
		return true
	}
	return c.isAllowedHost(origin)
}

// IsBlockedHost is true when the URL belongs to LoadPlay itself — standalone
// browser access, pasted CDN links, etc. Must never count as app context.
func (c Config) IsBlockedHost(raw string) bool {
	prefix, ok := hostPrefix(raw)
	if !ok {
		return false
	}
	for _, blocked := range c.BlockedOrigins {
		bp, ok := hostPrefix(blocked)
		if ok && bp == prefix {
			return true
		}
	}
	return false
}

func (c Config) isAllowedHost(raw string) bool {
	prefix, ok := hostPrefix(raw)
	if !ok {
		return false
	}
	for _, allowed := range c.AllowedOrigins {
		ap, ok := hostPrefix(allowed)
		if ok && strings.EqualFold(ap, prefix) {
			return true
		}
	}
	return false
}

func hostPrefix(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme == "" {
		scheme = "https"
	}
	return scheme + "://" + strings.ToLower(u.Host), true
}

func looksLikeTool(ua string) bool {
	if len(ua) < 8 {
		return true
	}
	lower := strings.ToLower(ua)
	for _, marker := range []string{
		"postmanruntime",
		"insomnia/",
		"curl/",
		"wget/",
		"python-requests/",
		"httpie/",
		"go-http-client",
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
