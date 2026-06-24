package handler

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/internal/cache"
	"goupload/loadplay/internal/diskcache"
	"goupload/loadplay/internal/fetchgate"
	"goupload/loadplay/internal/fingerprint"
	"goupload/loadplay/internal/guard"
	"goupload/loadplay/internal/guest"
	"goupload/loadplay/internal/hls"
	"goupload/loadplay/internal/manifestcache"
	"goupload/loadplay/internal/noncestore"
	"goupload/loadplay/internal/ratelimit"
	"goupload/loadplay/internal/token"
	"goupload/loadplay/lib/storage"
	"goupload/loadplay/lib/supabase"
	"goupload/lib/logger"
)

// ManifestDeps is everything a manifest handler needs from outside; passed
// in so the handler stays test-friendly and doesn't reach for globals.
type ManifestDeps struct {
	Log         *logger.Logger
	Secret      []byte
	Storage     storage.Config
	Guard       guard.Config
	HTTPClient  *http.Client
	PublicHost  string
	RequireBind bool
	FileCache     *cache.FileCache
	RateLimit     *ratelimit.Limiter
	Allowlist     *guest.Allowlist
	NonceStore    *noncestore.Store
	ManifestCache *manifestcache.Cache
	SegmentCache  *diskcache.Cache
	FetchGate       *fetchgate.Gate
	PlaybackDebug   bool
}

// ErrPlaybackDenied is the sentinel returned by deny() so callers'
// `if err != nil { return err }` actually short-circuits the handler.
//
// CRITICAL: deny() must NOT return nil. c.Status(...).JSON(...) returns
// nil on success, which would let the caller continue past the reject 
// the handler would then keep running, generate the manifest, and
// SendString it, overwriting the JSON body but leaving the 403 status.
// Result: 403 response with the real manifest in the body. That's a
// catastrophic leak: an attacker sees the segment URLs and can fetch
// them directly. The sentinel error breaks that chain.
var ErrPlaybackDenied = errors.New("playback denied")

// Generic "something is off, don't tell the client what" response.
// Per project rules: never leak server-side detail through the body.
// Returns ErrPlaybackDenied so the caller's `if err != nil` check fires.
func deny(c *fiber.Ctx, status int) error {
	setDenyResponseHeaders(c)
	_ = c.Status(status).JSON(fiber.Map{"error": "Something's wrong."})
	return ErrPlaybackDenied
}

func setDenyResponseHeaders(c *fiber.Ctx) {
	c.Set("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0")
	c.Set("Pragma", "no-cache")
	c.Set("Expires", "0")
	c.Set("CDN-Cache-Control", "no-store")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Robots-Tag", "noindex, noarchive, nofollow")
}

// redactUpstreamErr strips query strings from an error message before logging.
// Go's http client wraps the request URL into its error; for R2 that URL is a
// presigned link carrying X-Amz-Credential + X-Amz-Signature, which must never
// land in logs. Removing the query string keeps host/path for debugging while
// dropping the signing material.
func redactUpstreamErr(err error) string {
	if err == nil {
		return ""
	}
	return queryStringRe.ReplaceAllString(err.Error(), "?<redacted>")
}

var queryStringRe = regexp.MustCompile(`\?[^"\s]*`)

// extractClientIP picks the leftmost X-Forwarded-For when present
// (nginx sits in front); falls back to the immediate peer.
func extractClientIP(c *fiber.Ctx) string {
	xff := c.Get("X-Forwarded-For")
	return fingerprint.FromRequest(c.IP(), xff)
}

// Manifest handles GET /v/:fileId/master.m3u8 (and any sub-playlist
// referenced by the master). Validates token, fetches the playlist
// from storage, rewrites every line that names another playlist or
// segment file so the player keeps coming back through the CDN.
func Manifest(deps ManifestDeps) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// HARD GATE: Origin + Referer both required, both must match
		// allowed app/CDN hosts. Runs BEFORE token verify so curl /
		// address-bar / hot-link attempts are 403'd without revealing
		// whether the token is even valid.
		if denyResp := playbackPreflight(c, deps); denyResp != nil {
			return denyResp
		}

		rawTok := c.Query("t")
		if rawTok == "" {
			return deny(c, fiber.StatusUnauthorized)
		}
		tok, err := token.Verify(rawTok, deps.Secret)
		if err != nil {
			deps.Log.Errorf("manifest token reject reason=%s", err.Error())
			return deny(c, fiber.StatusUnauthorized)
		}

		if deny := softGuardOrFingerprint(c, deps, tok); deny != nil {
			return deny
		}
		if deny := enforcePlaybackSecurity(c, deps, rawTok, tok, true); deny != nil {
			return deny
		}

		askedPath := c.Params("*")
		if !manifestPathAllowed(askedPath, tok.Path) {
			deps.Log.Errorf("manifest path mismatch asked=%s allowed=%s", askedPath, tok.Path)
			return deny(c, fiber.StatusForbidden)
		}

		// DB-backed access control + per-file repo. Cached in RAM (default
		// 15 min on hits, 30s on misses, singleflight on concurrent misses)
		// so hundreds of segment fetches per video → one Supabase call.
		storageCfg, denyStatus := resolveAccessAndStorage(c.Context(), deps, tok)
		if denyStatus != 0 {
			return deny(c, denyStatus)
		}

		// Walk the manifest text. m3u8 line types we rewrite:
		//   - URI="..." attributes (EXT-X-MEDIA, EXT-X-MAP, EXT-X-KEY)
		//   - bare URLs on their own line (segment URIs after EXTINF, sub-playlist URIs after EXT-X-STREAM-INF)
		body, err := loadManifestBody(c, deps, storageCfg, askedPath)
		if err != nil {
			deps.Log.Errorf("manifest upstream fetch err=%s path=%s", redactUpstreamErr(err), askedPath)
			if errors.Is(err, fetchgate.ErrBusy) {
				c.Set("Retry-After", "2")
				return deny(c, fiber.StatusServiceUnavailable)
			}
			return deny(c, fiber.StatusBadGateway)
		}

		if tok.IsGuest() {
			preview := tok.GuestPreviewSeconds()
			if hls.IsMasterPlaylist(body) {
				body = hls.RestrictMasterToLowestRendition(body)
			}
			if hls.IsMediaPlaylist(body) {
				body = hls.TruncateMediaPlaylistAtDuration(body, preview)
				if deps.Allowlist != nil {
					deps.Allowlist.Register(playbackSessionKey(c, rawTok, tok), askedPath, body)
				}
			}
		}

		publicBase := requestPublicBase(c, deps)
		rewritten, err := rewriteManifest(body, askedPath, rawTok, tok.FileID, publicBase)
		if err != nil {
			deps.Log.Errorf("manifest rewrite err=%s", err.Error())
			return deny(c, fiber.StatusBadGateway)
		}

		setPlaybackResponseHeaders(c, deps)
		c.Set("Content-Type", "application/vnd.apple.mpegurl")
		return c.SendString(rewritten)
	}
}

// Permit the exact path the token bound, OR any other *.m3u8 under the
// same video asset tree (ABR subfolders like 480p/playlist.m3u8). The
// asset-root constraint stops a token for video A from reaching video B.
func manifestPathAllowed(asked, allowed string) bool {
	if asked == "" || allowed == "" {
		return false
	}
	if asked == allowed {
		return true
	}
	if !strings.HasSuffix(strings.ToLower(asked), ".m3u8") {
		return false
	}
	return pathUnderPlaybackRoot(asked, allowed)
}

func softGuardOrFingerprint(c *fiber.Ctx, deps ManifestDeps, tok *token.Playback) error {
	origin := c.Get("Origin")
	referer := c.Get("Referer")
	if reason := deps.Guard.Check(origin, referer, c.Get("User-Agent")); reason != "" {
		od := deps.Guard.Diagnose(origin)
		rd := deps.Guard.Diagnose(referer)
		deps.Log.Errorf(
			"guard reject reason=%s unique_id=%s origin_raw=%q origin_verdict=%s referer_raw=%q referer_verdict=%s allowed=%v ua=%q",
			reason, tok.FileID, origin, od.Reason, referer, rd.Reason, deps.Guard.AllowedList(), c.Get("User-Agent"),
		)
		return deny(c, fiber.StatusForbidden)
	}
	if !deps.RequireBind {
		return nil
	}
	ip := extractClientIP(c)
	ipHash := fingerprint.Hash(fingerprint.IPPrefix(ip))
	uaHash := fingerprint.Hash(c.Get("User-Agent"))
	if tok.IPHash != "" && tok.IPHash != ipHash {
		deps.Log.Errorf("fingerprint ip mismatch token=%s req=%s", tok.IPHash, ipHash)
		return deny(c, fiber.StatusUnauthorized)
	}
	if tok.UAHash != "" && tok.UAHash != uaHash {
		deps.Log.Errorf("fingerprint ua mismatch")
		return deny(c, fiber.StatusUnauthorized)
	}
	return nil
}

// resolveAccessAndStorage looks the file up via the cache (DB on miss,
// FIFO + TTL on hit), enforces token↔owner binding for private files,
// and returns the storage config  same as `deps.Storage` but with the
// per-file `github_repo` swapped in when the row has one. denyStatus is
// 0 when access is granted; non-zero is the HTTP status the caller
// should return to the client.
func resolveAccessAndStorage(ctx context.Context, deps ManifestDeps, tok *token.Playback) (storage.Config, int) {
	cfg := deps.Storage
	if deps.FileCache == nil {
		return cfg, 0
	}
	meta, err := deps.FileCache.Get(ctx, tok.FileID)
	if errors.Is(err, supabase.ErrNotFound) {
		deps.Log.Errorf("file not found unique_id=%s", tok.FileID)
		return cfg, fiber.StatusNotFound
	}
	if err != nil {
		// Upstream Supabase blip  fail closed but log. The cache won't
		// remember this so the next request can succeed.
		deps.Log.Errorf("meta fetch err=%s id=%s", err.Error(), tok.FileID)
		return cfg, fiber.StatusServiceUnavailable
	}
	if !meta.IsPublic {
		if tok.UserID == "" || tok.UserID != meta.OwnerID {
			deps.Log.Errorf("private access denied id=%s user=%s owner=%s", tok.FileID, tok.UserID, meta.OwnerID)
			return cfg, fiber.StatusForbidden
		}
	}
	// Per-file repo override beats env default when set.
	if meta.GithubRepo != "" {
		cfg.Repo = meta.GithubRepo
	}
	// Per-file storage backend. R2 files presign against the env-configured
	// bucket; fail closed if this LoadPlay instance has no R2 client.
	if meta.StorageBackend == "r2" {
		if cfg.R2 == nil {
			deps.Log.Errorf("r2 file but loadplay has no R2 client id=%s", tok.FileID)
			return cfg, fiber.StatusServiceUnavailable
		}
		if meta.StorageBucket != "" && meta.StorageBucket != cfg.R2.Bucket() {
			deps.Log.Errorf("r2 bucket mismatch id=%s file_bucket=%s client_bucket=%s", tok.FileID, meta.StorageBucket, cfg.R2.Bucket())
		}
		cfg.Backend = "r2"
		cfg.Bucket = meta.StorageBucket
	}
	return cfg, 0
}

// loadManifestBody folds three traffic controls into one call:
//   1. manifest body cache (~60s)  finished uploads are immutable, so
//      hot videos serve from RAM and never re-fetch GitHub
//   2. singleflight  concurrent misses for the same manifest collapse
//      into a single upstream fetch
//   3. fetch gate  caps concurrent upstream fetches so a slow GitHub
//      can't grow our in-flight queue unboundedly (returns ErrBusy →
//      503 + Retry-After to shed load)
func loadManifestBody(c *fiber.Ctx, deps ManifestDeps, st storage.Config, relPath string) (string, error) {
	fetch := func() (string, error) {
		if deps.FetchGate != nil {
			release, err := deps.FetchGate.Acquire(c.Context())
			if err != nil {
				return "", err
			}
			defer release()
		}
		return fetchUpstreamWith(c.Context(), deps, st, relPath)
	}
	if deps.ManifestCache == nil {
		return fetch()
	}
	key := st.Backend + "|" + st.Repo + "|" + st.Bucket + "|" + relPath
	return deps.ManifestCache.Do(key, fetch)
}

func fetchUpstreamWith(ctx context.Context, deps ManifestDeps, st storage.Config, relPath string) (string, error) {
	rawURL, err := st.RawURL(relPath)
	if err != nil {
		return "", err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	res, err := deps.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", io.ErrUnexpectedEOF
	}
	const maxManifest = 4 << 20 // 4 MiB hard cap; real manifests are KB
	limited := io.LimitReader(res.Body, maxManifest)
	buf := make([]byte, 0, 8192)
	br := bufio.NewReader(limited)
	for {
		chunk := make([]byte, 4096)
		n, err := br.Read(chunk)
		if n > 0 {
			buf = append(buf, chunk[:n]...)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
	}
	return string(buf), nil
}

// rewriteManifest swaps every storage path the manifest references into
// a CDN URL carrying the SAME token. One token, one playback session,
// the whole HLS surface is reachable until the token expires.
func rewriteManifest(body, manifestPath, rawToken, fileID, publicBase string) (string, error) {
	dir := path.Dir(manifestPath)
	if dir == "." {
		dir = ""
	}
	cdnPrefix := strings.TrimRight(publicBase, "/") + "/v/" + fileID + "/"

	resolve := func(uri string) string {
		// Absolute URLs aren't expected from our pipeline. If one ever
		// shows up in a manifest, drop it rather than echo it  that
		// would leak the storage origin (github raw) to the client.
		// Empty string preserves the line shape; the player will skip
		// the unresolvable segment and recover.
		if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
			return ""
		}
		var full string
		if dir == "" {
			full = uri
		} else {
			full = dir + "/" + uri
		}
		full = path.Clean(full)
		return cdnPrefix + full + "?t=" + rawToken
	}

	var out strings.Builder
	out.Grow(len(body) + 256)
	scanner := bufio.NewScanner(strings.NewReader(body))
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		switch {
		case trimmed == "":
			out.WriteString(line)
		case strings.HasPrefix(trimmed, "#"):
			out.WriteString(rewriteTagURI(line, resolve))
		default:
			out.WriteString(resolve(trimmed))
		}
		out.WriteByte('\n')
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return out.String(), nil
}

// rewriteTagURI handles `URI="..."` attributes inside tag lines like
// EXT-X-MAP, EXT-X-MEDIA, EXT-X-KEY. Anything else passes through.
func rewriteTagURI(line string, resolve func(string) string) string {
	const marker = `URI="`
	idx := strings.Index(line, marker)
	if idx < 0 {
		return line
	}
	start := idx + len(marker)
	end := strings.Index(line[start:], `"`)
	if end < 0 {
		return line
	}
	end += start
	original := line[start:end]
	return line[:start] + resolve(original) + line[end:]
}
