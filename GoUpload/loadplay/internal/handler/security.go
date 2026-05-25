package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/internal/fingerprint"
	"goupload/loadplay/internal/token"
)

// replayFingerprint identifies the requester for nonce binding. Uses
// the IP /24-or-/64 prefix plus UA hash — same coarse bucket as
// fingerprint binding so mobile cell↔wifi swaps don't false-positive.
func replayFingerprint(c *fiber.Ctx) string {
	ip := extractClientIP(c)
	ipBucket := fingerprint.Hash(fingerprint.IPPrefix(ip))
	uaBucket := fingerprint.Hash(c.Get("User-Agent"))
	return ipBucket + "|" + uaBucket
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
