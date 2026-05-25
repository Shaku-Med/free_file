package handler

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/internal/token"
)

// SegmentDeps mirrors ManifestDeps — both routes share the same shape
// (cache, secret, storage, guard, etc.). Aliasing keeps things tidy.
type SegmentDeps = ManifestDeps

// Segment handles GET /v/:fileId/* for non-m3u8 media (.ts, .m4s, .vtt, …).
// Validates the playback token, then proxies bytes from backing storage.
// Storage URLs never reach the client — same as /api/load/video.
func Segment(deps SegmentDeps) fiber.Handler {
	return func(c *fiber.Ctx) error {
		askedPath := c.Params("*")
		if strings.HasSuffix(strings.ToLower(askedPath), ".m3u8") {
			// m3u8 always goes through Manifest, never here.
			return Manifest(deps)(c)
		}

		rawTok := c.Query("t")
		if rawTok == "" {
			return deny(c, fiber.StatusUnauthorized)
		}
		tok, err := token.Verify(rawTok, deps.Secret)
		if err != nil {
			return deny(c, fiber.StatusUnauthorized)
		}
		if denyResp := softGuardOrFingerprint(c, deps, tok); denyResp != nil {
			return denyResp
		}
		if denyResp := enforcePlaybackSecurity(c, deps, rawTok, tok, false); denyResp != nil {
			return denyResp
		}
		if !pathUnderPlaybackRoot(askedPath, tok.Path) {
			deps.Log.Errorf("segment path outside asset tree asked=%s token_path=%s", askedPath, tok.Path)
			return deny(c, fiber.StatusForbidden)
		}

		// Guests get a truncated playlist; segments past the truncation
		// point are NOT registered in the allowlist, so direct .ts URL
		// guessing with the same ?t= must fail. This is what enforces
		// the preview cap — without it, the cap was advisory only.
		if tok.IsGuest() && deps.Allowlist != nil {
			if !deps.Allowlist.Allowed(playbackSessionKey(c, rawTok, tok), askedPath) {
				deps.Log.Errorf("guest segment outside preview window unique_id=%s path=%s", tok.FileID, askedPath)
				return deny(c, fiber.StatusForbidden)
			}
		}

		// Access control + per-file repo via the same cache pipeline as
		// the manifest path. Cached in RAM per unique_id — segment storms
		// do not translate into Supabase round-trips.
		storageCfg, denyStatus := resolveAccessAndStorage(c.Context(), deps, tok)
		if denyStatus != 0 {
			return deny(c, denyStatus)
		}

		return streamStorageObject(c, deps, storageCfg, askedPath)
	}
}
