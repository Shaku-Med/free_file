package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

// playbackPreflight is the HARDEST gate on the playback surface.
//
// Rules  no exceptions, no fallbacks:
//   1. Request MUST carry an Origin header.
//   2. Request MUST carry a Referer header.
//   3. Origin MUST exactly match one of ALLOWED_ORIGINS (parsed via
//      net/url so lookalike hosts like memories.brozy.org.evil.com fail).
//   4. Referer MUST exactly match either ALLOWED_ORIGINS (app fetch) or
//      BLOCKED_ORIGINS (HLS player following its own rewritten CDN URLs).
//
// Anything else  typed URL in address bar, "Open in new tab", curl,
// view-source, hot-linked <video src=...> on evil.com, bookmark  gets
// 403 here and never sees a single byte further down the pipeline.
//
// Called as the FIRST line of every playback handler. If a path skips
// this, that path is broken  fix the path, not this function.
func playbackPreflight(c *fiber.Ctx, deps ManifestDeps) error {
	origin := strings.TrimSpace(c.Get("Origin"))
	referer := strings.TrimSpace(c.Get("Referer"))

	// Hard kill: either header missing → not from a real player page.
	if origin == "" || referer == "" {
		deps.Log.Errorf(
			"preflight REJECT missing-header origin_present=%t referer_present=%t ua=%q path=%s",
			origin != "", referer != "",
			c.Get("User-Agent"), c.Path(),
		)
		return deny(c, fiber.StatusForbidden)
	}

	// Origin must be on the app allowlist. CDN-origin requests are NEVER
	// legitimate (the player only ever runs on the app domain).
	if !deps.Guard.AllowsOrigin(origin) {
		deps.Log.Errorf(
			"preflight REJECT origin-not-allowed origin=%q allowed=%v ua=%q path=%s",
			origin, deps.Guard.AllowedList(),
			c.Get("User-Agent"), c.Path(),
		)
		return deny(c, fiber.StatusForbidden)
	}

	// Referer must be app (typical fetch) OR CDN (player following its
	// own manifest's rewritten URLs back to itself). Anything else dies.
	if !deps.Guard.AllowsOrigin(referer) && !deps.Guard.IsBlockedHost(referer) {
		deps.Log.Errorf(
			"preflight REJECT referer-not-allowed referer=%q allowed=%v blocked=%v ua=%q path=%s",
			referer, deps.Guard.AllowedList(), deps.Guard.BlockedOrigins,
			c.Get("User-Agent"), c.Path(),
		)
		return deny(c, fiber.StatusForbidden)
	}

	return nil
}
