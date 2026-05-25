package guard

import (
	"net/url"
	"strings"
)

// Config holds hot-link / origin allowlists for LoadPlay.
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
	if strings.TrimSpace(origin) == "" || strings.TrimSpace(referer) == "" {
		return "missing-origin-or-referer"
	}
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
			return "self-referer"
		}
		if !c.isAllowedHost(referer) {
			return "referer"
		}
	}
	if c.BlockToolUA && looksLikeTool(userAgent) {
		return "tool-ua"
	}
	return ""
}

// HostVerdict explains why a header passed or failed the allowlist.
type HostVerdict struct {
	OK     bool
	Reason string // missing | parse_failed | blocked_cdn | not_in_allowlist | ok
	Parsed string // normalized scheme://host[:port]
}

// Diagnose checks one Origin or Referer value against the allowlist.
func (c Config) Diagnose(raw string) HostVerdict {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return HostVerdict{Reason: "missing"}
	}
	prefix, ok := hostPrefix(raw)
	if !ok {
		return HostVerdict{Reason: "parse_failed", Parsed: raw}
	}
	if c.IsBlockedHost(raw) {
		return HostVerdict{Reason: "blocked_cdn", Parsed: prefix}
	}
	if len(c.AllowedOrigins) == 0 {
		return HostVerdict{OK: true, Reason: "ok", Parsed: prefix}
	}
	if c.isAllowedHost(raw) {
		return HostVerdict{OK: true, Reason: "ok", Parsed: prefix}
	}
	return HostVerdict{Reason: "not_in_allowlist", Parsed: prefix}
}

func (c Config) AllowedList() []string {
	out := make([]string, len(c.AllowedOrigins))
	copy(out, c.AllowedOrigins)
	return out
}

// AllowsOrigin is true when raw parses to an exact scheme://host match on
// ALLOWED_ORIGINS. Uses net/url — never a substring/contains check, so
// https://memories.brozy.org.evil.com and
// https://evil.com/?ref=https://memories.brozy.org do not pass.
func (c Config) AllowsOrigin(raw string) bool {
	if raw == "" {
		return false
	}
	if c.IsBlockedHost(raw) {
		return false
	}
	if len(c.AllowedOrigins) == 0 {
		return true
	}
	return c.isAllowedHost(raw)
}

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
		if ok && ap == prefix {
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
	if u.User != nil {
		return "", false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", false
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port != "" {
		host = host + ":" + port
	}
	return scheme + "://" + host, true
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
