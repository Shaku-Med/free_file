package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

// hasPlaybackContext rejects every request that isn't a player subresource
// fetch from a real app page. Address-bar pastes, "Open in new tab",
// bookmarks, direct navigations, view-source — all rejected.
//
// We require BOTH:
//   - Sec-Fetch-* headers consistent with a player subresource fetch
//     (Mode != "navigate", Site != "none", Dest != "document"). Browsers
//     don't let JS forge these.
//   - App Origin/Referer signal pointing at memories.brozy.org.
func hasPlaybackContext(c *fiber.Ctx, deps ManifestDeps) bool {
	// Modern browsers emit these on every request. If they're absent
	// entirely the client is a curl/cli tool — reject. (Tool-UA filter
	// already catches the common cases; this is belt-and-suspenders.)
	mode := strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Mode")))
	site := strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Site")))
	dest := strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Dest")))

	// Address-bar paste / typed URL → mode=navigate, site=none, dest=document.
	// Right-click "Open in new tab" → same. Bookmarks too.
	if mode == "navigate" || dest == "document" {
		return false
	}
	// "none" = no referrer-y context (typed URL). Legit player fetches
	// are always "same-site" or "cross-site".
	if site == "none" {
		return false
	}
	// If Sec-Fetch is missing entirely (very old browser / non-browser
	// client), require explicit app headers to compensate. We still
	// allow it to fall through to the Origin check below; if those
	// aren't set either, we reject.
	if mode == "" && site == "" && dest == "" {
		// Falls through; the Origin/Referer check below will reject
		// unless the client manually set X-App-Origin (legitimate
		// fallback for old WebViews).
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
