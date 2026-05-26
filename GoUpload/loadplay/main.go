package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"goupload/loadplay/internal/cache"
	"goupload/loadplay/internal/fetchgate"
	"goupload/loadplay/internal/guard"
	"goupload/loadplay/internal/guest"
	"goupload/loadplay/internal/handler"
	"goupload/loadplay/internal/manifestcache"
	"goupload/loadplay/internal/noncestore"
	"goupload/loadplay/internal/ratelimit"
	"goupload/loadplay/lib/storage"
	"goupload/loadplay/lib/supabase"
	"goupload/lib/env"
	"goupload/lib/logger"
)

// Set at link time by Docker/CI (-ldflags). Verify prod via GET /live → "build" field.
var buildVersion = "dev"

func parseDurationEnv(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(env.Get(key, ""))
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

// LoadPlay  small CDN-style service that fronts HLS playback. Validates
// HMAC-signed playback tokens minted by the main app. Manifests are
// fetched + rewritten in flight; segments are proxied (storage URLs
// never sent to clients).
//
// Required env:
//   PLAYBACK_TOKEN_SECRET   shared HMAC secret with the main app
//   GITHUB_OWNER            org / user that owns the storage repo
//   GITHUB_REPO             repo name
// Optional env:
//   PORT                    default 3006
//   GITHUB_BRANCH           default "main"
//   ALLOWED_ORIGINS         CSV, e.g. "https://memories.brozy.org,http://localhost:3000"
//   BLOCKED_ORIGINS         CSV of LoadPlay's own origins; standalone access is rejected
//   PUBLIC_HOST             optional public CDN base, also added to blocked origins
//   REQUIRE_FINGERPRINT     "1" to enforce IP/UA binding (default off until app side starts emitting it)
//   BLOCK_TOOL_UA           "1" to reject curl/Postman/etc by UA string
//   PLAYBACK_DEBUG          "1" to log every successful origin/referer check too
func main() {
	lg := logger.New(2048)
	handler.SetBuildVersion(buildVersion)
	_ = env.Load(".env")

	secret := env.EnvValidator("PLAYBACK_TOKEN_SECRET")
	if secret == "" {
		log.Fatal("PLAYBACK_TOKEN_SECRET is required")
	}
	owner := env.EnvValidator("GITHUB_OWNER")
	repo := env.EnvValidator("GITHUB_REPO")
	if owner == "" || repo == "" {
		log.Fatal("GITHUB_OWNER and GITHUB_REPO are required")
	}

	// Optional Supabase wiring. Without these, LoadPlay still serves 
	// it just trusts the token's user/file binding without DB checks
	// and always uses the env GITHUB_REPO. Supplying both unlocks
	// per-file github_repo override + private-file owner enforcement.
	supaURL := env.EnvValidator("SUPABASE_URL")
	supaKey := env.EnvValidator("SUPABASE_SERVICE_KEY")
	var fileCache *cache.FileCache
	if supaURL != "" && supaKey != "" {
		client := supabase.New(supaURL, supaKey)
		hitTTL := parseDurationEnv("FILE_CACHE_HIT_TTL", 15*time.Minute)
		missTTL := parseDurationEnv("FILE_CACHE_MISS_TTL", 30*time.Second)
		fileCache = cache.New(cache.Config{
			Client:   client,
			EnvRepo:  repo,
			HitTTL:   hitTTL,
			MissTTL:  missTTL,
			MaxItems: 5000,
			OnUpstream: func(fileID string) {
				if env.Get("PLAYBACK_DEBUG", "0") == "1" {
					lg.Infof("file_cache upstream unique_id=%s (one Supabase round-trip; segments reuse RAM cache)", fileID)
				}
			},
		})
		lg.Infof("supabase access-control enabled (hit_ttl=%s miss_ttl=%s)", hitTTL, missTTL)
	} else {
		lg.Infof("supabase env not set  running without DB access control")
	}

	blockedOrigins := env.Get("BLOCKED_ORIGINS", "http://localhost:3006,https://cdn.memories.brozy.org")
	if ph := strings.TrimSpace(env.Get("PUBLIC_HOST", "")); ph != "" {
		blockedOrigins = blockedOrigins + "," + strings.TrimRight(ph, "/")
	}

	appEnv := env.Get("APP_ENV", "development")
	allowedOriginsCSV := env.Get("ALLOWED_ORIGINS", "")
	if appEnv == "production" && strings.TrimSpace(allowedOriginsCSV) == "" {
		log.Fatal("ALLOWED_ORIGINS is required when APP_ENV=production")
	}
	publicHost := env.Get("PUBLIC_HOST", "")
	if appEnv != "production" && strings.Contains(publicHost, "cdn.memories.brozy.org") {
		lg.Errorf(
			"WARNING: PUBLIC_HOST=%q while APP_ENV=%q  manifest rewrite will send segment URLs to PROD CDN even though LoadPlay runs locally. Unset PUBLIC_HOST or use http://localhost:3006 for local dev.",
			publicHost,
			appEnv,
		)
	}

	deps := handler.ManifestDeps{
		Log:    lg,
		Secret: []byte(secret),
		Storage: storage.Config{
			Owner:  owner,
			Repo:   repo,
			Branch: env.Get("GITHUB_BRANCH", "main"),
		},
		Guard:       guard.NewConfig(env.Get("ALLOWED_ORIGINS", ""), blockedOrigins, env.Get("BLOCK_TOOL_UA", "1") == "1"),
		HTTPClient:  &http.Client{Timeout: 20 * time.Second},
		PublicHost:  env.Get("PUBLIC_HOST", ""),
		RequireBind: env.Get("REQUIRE_FINGERPRINT", "0") == "1",
		FileCache:   fileCache,
		RateLimit:   ratelimit.New(),
		Allowlist:   guest.NewAllowlist(10 * time.Minute),
		// Replay defense: a token nonce sticks to the fingerprint that
		// used it first; copies pasted into another browser get 401.
		NonceStore: noncestore.New(30*time.Minute, 50_000),
		// Manifest body cache (~60s) + singleflight. Finished uploads
		// have immutable manifests, so hot videos serve from RAM and
		// avoid hammering GitHub.
		ManifestCache: manifestcache.New(60*time.Second, 2000),
		// Upstream concurrency cap. If GitHub slows, in-flight fetches
		// queue up to 2s then 503 with Retry-After so we shed load
		// instead of growing memory.
		FetchGate:     fetchgate.New(64, 2*time.Second),
		PlaybackDebug: env.Get("PLAYBACK_DEBUG", "0") == "1",
	}

	app := fiber.New(fiber.Config{
		AppName:               "LoadPlay",
		DisableStartupMessage: true,
		ReadTimeout:           30 * time.Second,
		WriteTimeout:          5 * time.Minute,
		IdleTimeout:           120 * time.Second,
		ProxyHeader:           "X-Forwarded-For",
		// deny() returns ErrPlaybackDenied AFTER writing the 4xx body.
		// Fiber's DefaultErrorHandler would overwrite with err.Error()
		//  we don't want that. Recognize the sentinel and just return
		// (response is already constructed). Everything else falls
		// through to a generic 500 with the same opaque body.
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			if errors.Is(err, handler.ErrPlaybackDenied) {
				return nil
			}
			c.Set("Cache-Control", "private, no-store")
			return c.Status(fiber.StatusInternalServerError).
				JSON(fiber.Map{"error": "Something's wrong."})
		},
	})
	app.Use(recover.New())

	// Browser playback from the main app (different origin/port) is
	// credentialess  auth rides in ?t= only. CORS must allow the app
	// origin without credentials so players don't attach huge app cookies.
	if strings.TrimSpace(allowedOriginsCSV) == "" {
		lg.Errorf("ALLOWED_ORIGINS is empty  all playback requests will be rejected (fail-closed)")
	} else {
		app.Use(cors.New(cors.Config{
			AllowOrigins:     allowedOriginsCSV,
			AllowMethods:     "GET,HEAD,OPTIONS",
			AllowHeaders:     "Origin,Accept,Range,Content-Type,X-App-Origin,X-App-Referer",
			AllowCredentials: false,
		}))
	}

	app.Get("/health", func(c *fiber.Ctx) error {
		if !handler.IsInternalPeer(c.IP()) {
			return handler.NotFound(c)
		}
		body := fiber.Map{"ok": true}
		if fileCache != nil {
			st := fileCache.Stats()
			body["file_cache"] = fiber.Map{
				"hits":      st.Hits,
				"misses":    st.Misses,
				"upstreams": st.Upstreams,
				"items":     st.Items,
			}
		}
		return c.JSON(body)
	})

	// Single route, both manifest + segment. Manifest sniffs on ".m3u8".
	app.Get("/v/:fileId/*", handler.Segment(deps))

	// Hidden prod go-live ledger  404 on purpose, body has version dates.
	app.Get("/live", handler.ProductionLive)

	// Catch-all  anything that isn't /health or /v/... returns a generic
	// 404 so the CDN doesn't advertise its existence to standalone
	// visitors. Must be registered LAST so it doesn't shadow real routes.
	app.Use(handler.NotFound)

	port := env.Get("PORT", "3006")
	lg.Infof("LoadPlay listening on :%s (playback security: origin+referer+sec-fetch+cors)", port)

	// Graceful shutdown: stop accepting, finish in-flight, then exit.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := app.Listen(":" + port); err != nil {
			lg.Errorf("listen err=%s", err.Error())
		}
	}()
	<-ctx.Done()
	lg.Infof("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = app.ShutdownWithContext(shutdownCtx)
}
