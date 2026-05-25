package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/internal/fingerprint"
	"goupload/loadplay/internal/token"
)

// replayFingerprint identifies the requester for nonce binding.
// Combines the network bucket (IP /24+UA hash) with the REQUEST SHAPE
// — Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest, the Accept-Language
// triplet, and whether X-App-Origin is set. A private-tab paste of the
// same URL on the same machine shows a different request shape (mode=
// navigate, site=none, dest=document, no X-App-Origin), so the second
// fetch arrives with a DIFFERENT fingerprint than the first and the
// nonce store rejects it.
func replayFingerprint(c *fiber.Ctx) string {
	ip := extractClientIP(c)
	ipBucket := fingerprint.Hash(fingerprint.IPPrefix(ip))
	uaBucket := fingerprint.Hash(c.Get("User-Agent"))

	// Coarse "is this a real player subresource fetch?" shape.
	// Address-bar paste → navigate|none|document
	// Player fetch     → cors|same-site|empty (or video/audio)
	shape := strings.Join([]string{
		strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Mode"))),
		strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Site"))),
		strings.ToLower(strings.TrimSpace(c.Get("Sec-Fetch-Dest"))),
		boolFlag(c.Get("X-App-Origin") != ""),
	}, "|")
	shapeBucket := fingerprint.Hash(shape)

	return ipBucket + "|" + uaBucket + "|" + shapeBucket
}

func boolFlag(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func safePrefix(s string) string {
	if len(s) <= 6 {
		return s
	}
	return s[:6]
}

func playbackSessionKey(c *fiber.Ctx, rawToken string, tok *token.Playback) string {
	ip := extractClientIP(c)
	h := sha256.Sum256([]byte(rawToken))
	return ip + "|" + tok.FileID + "|" + hex.EncodeToString(h[:8])
}

func enforcePlaybackSecurity(
	c *fiber.Ctx,
	deps ManifestDeps,
	rawToken string,
	tok *token.Playback,
	isManifest bool,
) error {
	if !hasPlaybackContext(c, deps) {
		deps.Log.Errorf(
			"playback reject not from app unique_id=%s origin=%q referer=%q app_origin=%q app_referer=%q sec_site=%q sec_mode=%q",
			tok.FileID, c.Get("Origin"), c.Get("Referer"), c.Get("X-App-Origin"), c.Get("X-App-Referer"),
			c.Get("Sec-Fetch-Site"), c.Get("Sec-Fetch-Mode"),
		)
		return deny(c, fiber.StatusForbidden)
	}
	// Nonce binding: a token's nonce is locked to the first fingerprint
	// that uses it. A copy of the URL pasted into another browser /
	// network gets rejected even if the HMAC + expiry are still valid.
	if deps.NonceStore != nil && tok.Nonce != "" {
		fp := replayFingerprint(c)
		if !deps.NonceStore.Check(tok.Nonce, fp) {
			deps.Log.Errorf("playback nonce replay unique_id=%s nonce_prefix=%s", tok.FileID, safePrefix(tok.Nonce))
			return deny(c, fiber.StatusUnauthorized)
		}
	}
	if tok.IsGuest() && tok.GuestPreviewSeconds() <= 0 {
		deps.Log.Errorf("guest token missing preview cap unique_id=%s", tok.FileID)
		return deny(c, fiber.StatusForbidden)
	}
	if deps.RateLimit == nil {
		return nil
	}
	key := playbackSessionKey(c, rawToken, tok)
	if isManifest {
		if deps.RateLimit.AllowManifest(key) {
			return nil
		}
		deps.Log.Errorf("manifest rate limit unique_id=%s", tok.FileID)
		c.Set("Retry-After", "30")
		return deny(c, fiber.StatusTooManyRequests)
	}
	if deps.RateLimit.AllowSegment(key) {
		return nil
	}
	deps.Log.Errorf("segment rate limit unique_id=%s", tok.FileID)
	c.Set("Retry-After", strconv.Itoa(deps.RateLimit.SegmentRetryAfter(key)))
	return deny(c, fiber.StatusTooManyRequests)
}
