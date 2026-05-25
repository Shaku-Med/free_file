package handler

import (
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/internal/guard"
	"goupload/lib/logger"
)

type playbackContextResult struct {
	OK     bool
	Detail string
	Origin guard.HostVerdict
	Refer  guard.HostVerdict
}

func checkPlaybackContext(c *fiber.Ctx, deps ManifestDeps) playbackContextResult {
	rawOrigin := strings.TrimSpace(c.Get("Origin"))
	rawReferer := strings.TrimSpace(c.Get("Referer"))
	origin := deps.Guard.Diagnose(rawOrigin)
	referer := deps.Guard.Diagnose(rawReferer)

	if !origin.OK {
		return playbackContextResult{
			OK:     false,
			Detail: fmt.Sprintf("origin_%s", origin.Reason),
			Origin: origin,
			Refer:  referer,
		}
	}
	if !referer.OK {
		return playbackContextResult{
			OK:     false,
			Detail: fmt.Sprintf("referer_%s", referer.Reason),
			Origin: origin,
			Refer:  referer,
		}
	}
	// X-App-Origin / X-App-Referer custom headers are belt-and-suspenders
	// but they don't survive every browser/HLS-loader path (CORS preflight
	// strips them on some master.m3u8 requests). The standard Origin +
	// Referer pair we already validated above is sufficient  they're set
	// by the browser, not JS, so curl / address-bar paste / hot-link all
	// die at the origin/referer gate. If the headers ARE present, treat
	// them as bonus signal (logged), but never block on absence.
	if reason := standaloneReason(c); reason != "" {
		return playbackContextResult{
			OK:     false,
			Detail: reason,
			Origin: origin,
			Refer:  referer,
		}
	}
	return playbackContextResult{
		OK:     true,
		Detail: "ok",
		Origin: origin,
		Refer:  referer,
	}
}

func hasPlaybackContext(c *fiber.Ctx, deps ManifestDeps) bool {
	return checkPlaybackContext(c, deps).OK
}

func logPlaybackContext(
	log *logger.Logger,
	debug bool,
	tag string,
	fileID string,
	c *fiber.Ctx,
	deps ManifestDeps,
	result playbackContextResult,
) {
	allowed := deps.Guard.AllowedList()
	if result.OK {
		if !debug {
			return
		}
		log.Infof(
			"%s pass unique_id=%s origin_raw=%q origin_parsed=%q referer_raw=%q referer_parsed=%q allowed=%v sec_mode=%q sec_site=%q sec_dest=%q x_app_origin=%q x_app_referer=%q",
			tag, fileID,
			c.Get("Origin"), result.Origin.Parsed,
			c.Get("Referer"), result.Refer.Parsed,
			allowed,
			c.Get("Sec-Fetch-Mode"), c.Get("Sec-Fetch-Site"), c.Get("Sec-Fetch-Dest"),
			c.Get("X-App-Origin"), c.Get("X-App-Referer"),
		)
		return
	}
	log.Errorf(
		"%s REJECT unique_id=%s reason=%s origin_raw=%q origin_verdict=%s origin_parsed=%q referer_raw=%q referer_verdict=%s referer_parsed=%q allowed=%v blocked=%v sec_mode=%q sec_site=%q sec_dest=%q x_app_origin=%q x_app_referer=%q ua=%q path=%s",
		tag, fileID, result.Detail,
		c.Get("Origin"), result.Origin.Reason, result.Origin.Parsed,
		c.Get("Referer"), result.Refer.Reason, result.Refer.Parsed,
		allowed, deps.Guard.BlockedOrigins,
		c.Get("Sec-Fetch-Mode"), c.Get("Sec-Fetch-Site"), c.Get("Sec-Fetch-Dest"),
		c.Get("X-App-Origin"), c.Get("X-App-Referer"),
		c.Get("User-Agent"), c.Path(),
	)
}

func setPlaybackCORS(c *fiber.Ctx, deps ManifestDeps) {
	origin := strings.TrimSpace(c.Get("Origin"))
	if origin != "" && deps.Guard.AllowsOrigin(origin) {
		c.Set("Access-Control-Allow-Origin", origin)
	}
}

// setPlaybackResponseHeaders prevents browsers from caching segments/manifests
// for later standalone replay (paste URL in new tab). Without no-store the
// player fetch caches bytes and a navigation load can replay them without
// hitting our origin/referer gate.
func setPlaybackResponseHeaders(c *fiber.Ctx, deps ManifestDeps) {
	setPlaybackCORS(c, deps)
	c.Set("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0")
	c.Set("Pragma", "no-cache")
	c.Set("Expires", "0")
	c.Set("CDN-Cache-Control", "no-store")
	c.Set("Vary", "Origin, Referer, Sec-Fetch-Mode, Sec-Fetch-Dest, Sec-Fetch-Site")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Robots-Tag", "noindex, noarchive, nofollow")
}

// standaloneReason is non-empty when the request looks like address-bar /
// "Open in new tab" navigation or a direct download  NOT an in-page
// HLS.js XHR (cors + same-site|cross-site + dest=empty).
func standaloneReason(c *fiber.Ctx) string {
	mode := strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Mode")))
	dest := strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Dest")))
	site := strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Site")))
	accept := strings.ToLower(strings.TrimSpace(c.Get("Accept")))

	// curl/wget/scripts omit the Sec-Fetch-* family; real browser subresource
	// fetches (HLS.js XHR) always send at least Sec-Fetch-Mode.
	if mode == "" && dest == "" && site == "" {
		return "missing_sec_fetch"
	}

	// User-initiated top-level navigation (omnibox, open-in-new-tab).
	if strings.TrimSpace(c.Get("Sec-Fetch-User")) == "?1" {
		return "standalone_user_navigation"
	}
	// Browser page loads ask for HTML, not HLS segment bytes.
	if strings.Contains(accept, "text/html") {
		return "standalone_html_accept"
	}
	switch {
	case mode == "navigate":
		return "standalone_navigate"
	case dest == "document" || dest == "iframe":
		return "standalone_document"
	case dest == "video" || dest == "audio":
		return "standalone_media_dest"
	case site == "none":
		return "standalone_site_none"
	// HLS.js in-page fetch must be cors + same-site|cross-site + empty dest.
	case mode != "cors":
		return "standalone_fetch_mode_" + mode
	case site != "same-site" && site != "cross-site" && site != "same-origin":
		return "standalone_site_" + site
	case dest != "empty":
		return "standalone_dest_" + dest
	}
	return ""
}

// appAttestationReason requires X-App-Origin + X-App-Referer  set only by
// our HLS.js client (useHLS.ts). nginx reverse proxies must NOT inject these;
// if they only forge Origin/Referer/Sec-Fetch, curl still fails here.
func appAttestationReason(c *fiber.Ctx, deps ManifestDeps) string {
	xOrigin := strings.TrimSpace(c.Get("X-App-Origin"))
	xReferer := strings.TrimSpace(c.Get("X-App-Referer"))
	if xOrigin == "" || xReferer == "" {
		return "missing_app_headers"
	}
	if v := deps.Guard.Diagnose(xOrigin); !v.OK {
		return "app_origin_" + v.Reason
	}
	if v := deps.Guard.Diagnose(xReferer); !v.OK {
		return "app_referer_" + v.Reason
	}
	return ""
}

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
	return scheme + "://" + c.Hostname()
}
