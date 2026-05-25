package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

// hasPlaybackContext requires an app Origin signal plus a Referer signal.
// Browsers omit Referer on many HLS fetches, so the player also sends
// X-App-Origin and X-App-Referer. Standalone CDN access (address-bar
// navigation or missing app headers) is rejected.
func hasPlaybackContext(c *fiber.Ctx, deps ManifestDeps) bool {
	if isNavigateFetch(c) {
		return false
	}

	origin := strings.TrimSpace(c.Get("Origin"))
	appOrigin := strings.TrimSpace(c.Get("X-App-Origin"))
	referer := effectiveReferer(c)

	if origin != "" && deps.Guard.IsBlockedHost(origin) {
		return false
	}
	if appOrigin != "" && deps.Guard.IsBlockedHost(appOrigin) {
		return false
	}

	appOriginOK := (origin != "" && deps.Guard.AllowsOrigin(origin)) ||
		(appOrigin != "" && deps.Guard.AllowsOrigin(appOrigin))
	if !appOriginOK {
		return false
	}

	if referer == "" {
		return false
	}

	if deps.Guard.IsBlockedHost(referer) {
		return true
	}

	return deps.Guard.AllowsOrigin(referer)
}

func effectiveReferer(c *fiber.Ctx) string {
	if r := strings.TrimSpace(c.Get("Referer")); r != "" {
		return r
	}
	return strings.TrimSpace(c.Get("X-App-Referer"))
}

func isNavigateFetch(c *fiber.Ctx) bool {
	return strings.EqualFold(strings.TrimSpace(c.Get("Sec-Fetch-Mode")), "navigate")
}

func setPlaybackCORS(c *fiber.Ctx, deps ManifestDeps) {
	origin := strings.TrimSpace(c.Get("Origin"))
	if origin != "" && deps.Guard.AllowsOrigin(origin) {
		c.Set("Access-Control-Allow-Origin", origin)
		c.Set("Vary", "Origin")
		return
	}
	appOrigin := strings.TrimSpace(c.Get("X-App-Origin"))
	if appOrigin != "" && deps.Guard.AllowsOrigin(appOrigin) {
		c.Set("Access-Control-Allow-Origin", appOrigin)
		c.Set("Vary", "Origin")
	}
}

// requestPublicBase returns the URL prefix used when rewriting manifest
// segment URIs. The Host header is attacker-controllable, so we ONLY
// honour it when the resulting origin appears on the operator-curated
// blocked-origins list (which doubles as "LoadPlay's own public hosts").
// Anything else falls back to the explicit PUBLIC_HOST, then to the
// first blocked origin — never to the raw Host. Prevents an attacker
// from making the player follow up to evil.com with our token attached.
func requestPublicBase(c *fiber.Ctx, deps ManifestDeps) string {
	if h := strings.TrimSpace(deps.PublicHost); h != "" {
		return strings.TrimRight(h, "/")
	}
	scheme := "http"
	if c.Protocol() == "https" {
		scheme = "https"
	}
	host := strings.TrimSpace(c.Get("Host"))
	if host != "" {
		candidate := scheme + "://" + host
		if deps.Guard.IsBlockedHost(candidate) {
			return candidate
		}
	}
	if len(deps.Guard.BlockedOrigins) > 0 {
		return strings.TrimRight(deps.Guard.BlockedOrigins[0], "/")
	}
	// Last resort: c.Hostname() is parsed from Host too, but only host
	// portion, no scheme injection. Still safer than echoing the raw header.
	return scheme + "://" + c.Hostname()
}
