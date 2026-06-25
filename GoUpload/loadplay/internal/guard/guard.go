package guard

import (
	"net"
	"net/url"
	"strings"
)

// Config holds hot-link / origin allowlists for LoadPlay.
type Config struct {
	AllowedOrigins []string
	BlockedOrigins []string
	BlockToolUA    bool
	// DevAllowPrivateHosts, when true (DEVELOPMENT ONLY), additionally accepts
	// origins/referers whose host is a loopback / RFC1918 private / link-local
	// IP (or "localhost"). Lets you open the app from a phone on the LAN
	// (e.g. http://192.168.1.169:3000) without hardcoding the IP, which changes.
	// It is gated to APP_ENV != "production" in main.go and only ever widens to
	// non-routable addresses, so it is inert and harmless if it ever ships on.
	DevAllowPrivateHosts bool
}

func NewConfig(originsCSV, blockedCSV string, blockToolUA bool, devAllowPrivateHosts bool) Config {
	return Config{
		AllowedOrigins:       splitCSV(originsCSV),
		BlockedOrigins:       splitCSV(blockedCSV),
		BlockToolUA:          blockToolUA,
		DevAllowPrivateHosts: devAllowPrivateHosts,
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
	if c.BlockToolUA && looksLikeTool(userAgent) {
		return "tool-ua"
	}
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
	if c.DevAllowPrivateHosts && isPrivateOrLoopbackHost(raw) {
		return HostVerdict{OK: true, Reason: "dev_private_host", Parsed: prefix}
	}
	if len(c.AllowedOrigins) == 0 {
		return HostVerdict{Reason: "not_in_allowlist", Parsed: prefix}
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
// ALLOWED_ORIGINS. Uses net/url  never a substring/contains check, so
// https://memories.brozy.org.evil.com and
// https://evil.com/?ref=https://memories.brozy.org do not pass.
func (c Config) AllowsOrigin(raw string) bool {
	if raw == "" {
		return false
	}
	if c.IsBlockedHost(raw) {
		return false
	}
	if c.DevAllowPrivateHosts && isPrivateOrLoopbackHost(raw) {
		return true
	}
	if len(c.AllowedOrigins) == 0 {
		return false
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
	if c.DevAllowPrivateHosts && isPrivateOrLoopbackHost(raw) {
		return true
	}
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

// isPrivateOrLoopbackHost reports whether raw's host is "localhost" or a
// loopback / RFC1918 private / link-local IP LITERAL. It parses the URL and runs
// net.ParseIP on the hostname — never a substring/contains check — so a public
// DNS name like "192.168.1.169.attacker.com" (not an IP) returns false, and an
// attacker cannot smuggle a public host past the gate. Only non-routable
// addresses qualify, so even if enabled in production it cannot expose anything
// reachable from the internet.
func isPrivateOrLoopbackHost(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.User != nil {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

// ToolUARejected reports whether the UA looks like a scripting/download tool
// (curl, wget, python-requests, empty UA, ...). The cast path skips the
// origin/referer gate (a TV has neither) but still runs this so a plain
// `curl <cast-url>` is blocked  the Chromecast UA ("CrKey/...") is not a tool.
func (c Config) ToolUARejected(userAgent string) bool {
	return c.BlockToolUA && looksLikeTool(userAgent)
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
