package fingerprint

import (
	"crypto/sha256"
	"encoding/base64"
	"net"
	"strings"
)

// IP binding uses a coarse prefix so mobile users flipping cell ↔ wifi
// don't lose their stream every time their IP changes:
//   - IPv4 → /24 (first 3 octets)
//   - IPv6 → /64 (first 4 groups)
func IPPrefix(ip string) string {
	clean := strings.TrimSpace(ip)
	if clean == "" {
		return ""
	}
	parsed := net.ParseIP(clean)
	if parsed == nil {
		return ""
	}
	if v4 := parsed.To4(); v4 != nil {
		return v4.Mask(net.CIDRMask(24, 32)).String()
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String()
}

// Hash produces a short, stable base64url digest. Same input, same output
// across app + CDN  that's how the main app pre-computes the value to
// embed in the token and we re-compute here to compare.
func Hash(s string) string {
	if s == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(s))
	return base64.RawURLEncoding.EncodeToString(sum[:12])
}

// FromRequest is a convenience that picks the closest-to-the-client IP
// from X-Forwarded-For + the connection peer. Trust the leftmost entry
// only when this service sits behind a proxy you control (nginx); if
// it's exposed directly, prefer the peer address.
func FromRequest(remoteAddr, xff string) string {
	if xff != "" {
		// XFF is comma-separated; leftmost is the originating client.
		parts := strings.Split(xff, ",")
		ip := strings.TrimSpace(parts[0])
		if ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	return remoteAddr
}
