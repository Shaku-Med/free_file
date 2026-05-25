package main

import (
	"context"
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

// LoadPlay — small CDN-style service that fronts HLS playback. Validates
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
func main() {
	lg := logger.New(2048)
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

	// Optional Supabase wiring. Without these, LoadPlay still serves —
	// it just trusts the token's user/file binding without DB checks
	// and always uses the env GITHUB_REPO. Supplying both unlocks
	// per-file github_repo override + private-file owner enforcement.
	supaURL := env.EnvValidator("SUPABASE_URL")
	supaKey := env.EnvValidator("SUPABASE_SERVICE_KEY")
	var fileCache *cache.FileCache
	if supaURL != "" && supaKey != "" {
		client := supabase.New(supaURL, supaKey)
		fileCache = cache.New(cache.Config{
			Client:   client,
			EnvRepo:  repo,
			HitTTL:   5 * time.Minute,
			MissTTL:  30 * time.Second,
			MaxItems: 5000,
		})
		lg.Infof("supabase access-control enabled (hit_ttl=5m miss_ttl=30s)")
	} else {
		lg.Infof("supabase env not set — running without DB access control")
	}

	blockedOrigins := env.Get("BLOCKED_ORIGINS", "http://localhost:3006,https://cdn.memories.brozy.org")
	if ph := strings.TrimSpace(env.Get("PUBLIC_HOST", "")); ph != "" {
		blockedOrigins = blockedOrigins + "," + strings.TrimRight(ph, "/")
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
		FetchGate: fetchgate.New(64, 2*time.Second),
	}

	app := fiber.New(fiber.Config{
		AppName:               "LoadPlay",
		DisableStartupMessage: true,
		ReadTimeout:           30 * time.Second,
		WriteTimeout:          5 * time.Minute,
		IdleTimeout:           120 * time.Second,
		ProxyHeader:           "X-Forwarded-For",
	})
	app.Use(recover.New())

	// Browser playback from the main app (different origin/port) is
	// credentialess — auth rides in ?t= only. CORS must allow the app
	// origin without credentials so players don't attach huge app cookies.
	allowedOrigins := env.Get("ALLOWED_ORIGINS", "")
	if allowedOrigins != "" {
		app.Use(cors.New(cors.Config{
			AllowOrigins:     allowedOrigins,
			AllowMethods:     "GET,HEAD,OPTIONS",
			AllowHeaders:     "Origin,Accept,Range,Content-Type,X-App-Origin,X-App-Referer",
			AllowCredentials: false,
		}))
	}

	app.Get("/health", handler.Health)

	// Single route, both manifest + segment. Manifest sniffs on ".m3u8".
	app.Get("/v/:fileId/*", handler.Segment(deps))

	port := env.Get("PORT", "3006")
	lg.Infof("LoadPlay listening on :%s", port)

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
