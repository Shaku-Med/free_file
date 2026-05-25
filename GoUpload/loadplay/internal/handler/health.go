package handler

import (
	"net"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// Health is reachable only from loopback (docker healthcheck) or the
// docker bridge gateway. External hits get the same generic 404 as any
// other unknown path so the CDN doesn't advertise itself.
func Health(c *fiber.Ctx) error {
	if !IsInternalPeer(c.IP()) {
		return NotFound(c)
	}
	return c.JSON(fiber.Map{"ok": true})
}

// NotFound is the catch-all for any request that doesn't match a real
// route. Returns the same generic body as the playback denies so the
// CDN looks indistinguishable from "nothing here" to a casual visitor.
func NotFound(c *fiber.Ctx) error {
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Something's wrong."})
}

// IsInternalPeer reports loopback or RFC1918 private peers (docker bridge).
func IsInternalPeer(ip string) bool {
	clean := strings.TrimSpace(ip)
	if clean == "" {
		return false
	}
	parsed := net.ParseIP(clean)
	if parsed == nil {
		return false
	}
	if parsed.IsLoopback() {
		return true
	}
	// Docker bridge / private networks. The host nginx never proxies
	// /health (we block it at the nginx layer too), so this is the
	// docker compose health probe path.
	return parsed.IsPrivate()
}
