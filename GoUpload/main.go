package main

import (
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"goupload/internal/captions"
	"goupload/internal/commentimg"
	"goupload/internal/embedproxy"
	"goupload/internal/middleware"
	"goupload/internal/profilepic"
	"goupload/internal/purge"
	"goupload/internal/testpage"
	"goupload/internal/thumbnail"
	"goupload/internal/upload"
	"goupload/internal/worker"
	embedlib "goupload/lib/embed"
	"goupload/lib/env"
	ghlib "goupload/lib/github"
	"goupload/lib/logger"
	"goupload/lib/nsfwstrikes"
	"goupload/lib/queue"
	"goupload/lib/r2"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

func main() {
	_ = env.Load(".env")
	appLog := logger.New(2048)

	redisAddr := env.Get("REDIS_ADDR", "localhost:6379")
	redisPass := env.Get("REDIS_PASSWORD", "")
	q, err := queue.NewClient(redisAddr, redisPass, 0, "upload_jobs")
	if err != nil {
		log.Fatalf("redis connection failed: %v", err)
	}
	defer q.Close()

	chunksDir := "upload/temp"
	outputDir := "upload/assembled"

	manager := upload.NewManager(upload.ManagerConfig{
		BaseDir:       chunksDir,
		MaxDiskBytes:  40 << 30,
		MaxConcurrent: 10,
		ChunkSize:     25 << 20,
	})

	nsfwAPI := env.Get("NSFW_API_URL", "http://localhost:3004/api/nsfw/detect")
	webhookSecret := env.Get("UPLOAD_WEBHOOK_SECRET", "")

	// Local embedding sidecar (semantic search). Optional: when EMBED_API_URL
	// is unset everything degrades to lexical-only search.
	embedClient := embedlib.NewClient(env.Get("EMBED_API_URL", ""), env.Get("EMBED_API_SECRET", ""))
	if embedClient.Enabled() {
		appLog.Infof("embed client ready url=%s", env.Get("EMBED_API_URL", ""))
	}

	ghToken := env.Get("GITHUB_TOKEN", "")
	ghOwner := env.Get("GITHUB_OWNER", "")
	ghRepo := strings.TrimSpace(env.Get("GITHUB_REPO", ""))
	if ghToken != "" && ghOwner != "" && ghRepo == "" {
		log.Fatal("GITHUB_REPO must be set when GITHUB_TOKEN and GITHUB_OWNER are set")
	}

	strikeMax := int(env.GetInt64("NSFW_STRIKE_MAX", 20))
	strikeWindow := time.Duration(env.GetInt64("NSFW_STRIKE_WINDOW_SEC", 3600)) * time.Second
	nsfwStrikes := nsfwstrikes.New(q.Redis(), strikeMax, strikeWindow)
	if nsfwStrikes.Enabled() {
		appLog.Infof("nsfw strike limiter max=%d window=%s", strikeMax, strikeWindow)
	}

	// R2 (dual-backend). When UPLOAD_STORAGE_BACKEND=r2, new uploads go to R2;
	// legacy files keep resolving via their stored github_repo.
	r2Client := r2.FromEnv()
	storageBackend := strings.ToLower(strings.TrimSpace(env.Get("UPLOAD_STORAGE_BACKEND", "github")))
	if storageBackend == "r2" && r2Client == nil {
		log.Fatal("UPLOAD_STORAGE_BACKEND=r2 but R2_* env not fully configured (need R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_ACCOUNT_ID or R2_ENDPOINT)")
	}
	if r2Client != nil {
		appLog.Infof("r2 client ready bucket=%s active_backend=%s", r2Client.Bucket(), storageBackend)
	}

	wcfg := worker.Config{
		ChunksDir:      chunksDir,
		OutputDir:      outputDir,
		TempDir:        "upload/temp_processing",
		HLSDir:         "upload/hls",
		ThumbnailDir:   "upload/thumbnails",
		NSFWApiURL:     nsfwAPI,
		NSFWApiSecret:  webhookSecret,
		GitHubOwner:    ghOwner,
		GitHubRepo:     ghRepo,
		R2:             r2Client,
		StorageBackend: storageBackend,
		Embed:          embedClient,
	}
	if ghToken != "" && ghOwner != "" {
		wcfg.GitHubClient = ghlib.NewClient(ghlib.Config{Token: ghToken, Owner: ghOwner, Repo: ghRepo})
	}
	w := worker.New(q, appLog, wcfg)
	pool := worker.NewPool(w, worker.PoolConfig{
		MinWorkers:     int(env.GetInt64("WORKER_MIN", 1)),
		MaxWorkers:     int(env.GetInt64("WORKER_MAX", 6)),
		InitialWorkers: int(env.GetInt64("WORKER_INITIAL", 2)),
	})
	pool.Start()

	app := fiber.New(fiber.Config{
		BodyLimit:      int(upload.ChunkSizeBytes),
		ReadBufferSize: 1024 * 1024,
		ReadTimeout:    90 * time.Second,
		WriteTimeout:   90 * time.Second,
		IdleTimeout:    60 * time.Second,
	})

	// CORS: allow app origin for browser uploads.
	//
	// SECURITY: Access-Control-Allow-Credentials: true MUST NEVER be combined with a
	// reflective / wildcard origin policy  doing so lets any website the user visits
	// make authenticated requests against this server and read the responses. We only
	// send credentials when the request's Origin is in an explicit allowlist; any other
	// accepted origin (dev-mode reflection, "*") is served WITHOUT credentials.
	corsOrigins := env.Get("CORS_ORIGINS", env.Get("APP_BASE_URL", "http://localhost:3000"))
	if corsOrigins == "" {
		corsOrigins = "*"
	}
	origins := corsOrigins

	isInExplicitAllowlist := func(origin string) bool {
		if origins == "" || origins == "*" || origin == "" {
			return false
		}
		for _, o := range strings.Split(origins, ",") {
			if strings.TrimSpace(o) == origin {
				return true
			}
		}
		return false
	}

	app.Use(func(c *fiber.Ctx) error {
		origin := c.Get("Origin")
		allow := false
		if isInExplicitAllowlist(origin) {
			allow = true
			c.Set("Access-Control-Allow-Credentials", "true")
		} else if origin != "" && (env.IsDev() || origins == "*") {
			// Reflective allow: no credentials  browsers will refuse authenticated
			// cross-origin reads, which is the desired safe default.
			allow = true
		}
		if allow {
			c.Set("Access-Control-Allow-Origin", origin)
			c.Set("Vary", "Origin")
			if c.Method() == fiber.MethodOptions {
				c.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD")
				c.Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-Upload-ID, X-Chunk-Index, X-User-ID")
				c.Set("Access-Control-Max-Age", "600")
				return c.SendStatus(fiber.StatusNoContent)
			}
		} else if c.Method() == fiber.MethodOptions {
			return c.SendStatus(fiber.StatusForbidden)
		}
		return c.Next()
	})

	app.Use("/api/upload", middleware.AuthUpload())
	app.Use("/api/thumbnail", middleware.AuthUpload())
	app.Use("/api/comment-image", middleware.AuthUpload())
	app.Use("/api/profilepic", middleware.AuthUpload())
	app.Use("/api/captions", middleware.AuthUpload())

	// Per-user rate limit for upload endpoints. Keyed by authenticated userID (set by
	// AuthUpload above), falling back to IP for anything that slips through. The chunk
	// endpoint dominates traffic, so the budget (300/min) is sized for resumable uploads
	// of multi-chunk files while still cutting off abuse.
	uploadLimiter := limiter.New(limiter.Config{
		Max:        300,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			if v, ok := c.Locals(middleware.LocalsUserID).(string); ok && v != "" {
				return "u:" + v
			}
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			c.Set("Retry-After", "60")
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "rate_limited"})
		},
	})
	app.Use("/api/upload", uploadLimiter)
	app.Use("/api/thumbnail", uploadLimiter)
	app.Use("/api/comment-image", uploadLimiter)
	app.Use("/api/profilepic", uploadLimiter)

	captionLimiter := limiter.New(limiter.Config{
		Max:        30,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			if v, ok := c.Locals(middleware.LocalsUserID).(string); ok && v != "" {
				return "u:" + v
			}
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			c.Set("Retry-After", "60")
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "rate_limited"})
		},
	})
	app.Use("/api/captions", captionLimiter)
	supabaseURL := env.EnvValidator("SUPABASE_URL")
	supabaseKey := env.EnvValidator("SUPABASE_SERVICE_ROLE_KEY")
	if supabaseKey == "" {
		supabaseKey = env.EnvValidator("SUPABASE_ANON_KEY")
	}
	upload.RegisterRoutes(app, manager, q, appLog)
	embedproxy.RegisterRoutes(app, appLog, embedClient, webhookSecret)
	thumbnail.RegisterRoutes(app, appLog, thumbnail.Config{
		GitHubClient:  wcfg.GitHubClient,
		GitHubOwner:   ghOwner,
		GitHubRepo:    ghRepo,
		NSFWApiURL:    nsfwAPI,
		NSFWApiSecret: webhookSecret,
		Strikes:       nsfwStrikes,
		AssembledRoot: outputDir,
		R2:            r2Client,
		SupabaseURL:   supabaseURL,
		SupabaseKey:   supabaseKey,
	})
	commentimg.RegisterRoutes(app, appLog, commentimg.Config{
		GitHubClient:   wcfg.GitHubClient,
		GitHubOwner:    ghOwner,
		GitHubRepo:     ghRepo,
		NSFWApiURL:     nsfwAPI,
		NSFWApiSecret:  webhookSecret,
		Strikes:        nsfwStrikes,
		R2:             r2Client,
		StorageBackend: storageBackend,
		SupabaseURL:    supabaseURL,
		SupabaseKey:    supabaseKey,
	})
	profilepic.RegisterRoutes(app, appLog, profilepic.Config{
		GitHubClient:   wcfg.GitHubClient,
		GitHubOwner:    ghOwner,
		GitHubRepo:     ghRepo,
		NSFWApiURL:     nsfwAPI,
		NSFWApiSecret:  webhookSecret,
		Strikes:        nsfwStrikes,
		SupabaseURL:    supabaseURL,
		SupabaseKey:    supabaseKey,
		R2:             r2Client,
		StorageBackend: storageBackend,
	})
	captions.RegisterRoutes(app, appLog, captions.Config{
		GitHubClient: wcfg.GitHubClient,
		GitHubOwner:  ghOwner,
		AppBaseURL:   env.Get("APP_BASE_URL", "http://localhost:3000"),
		AppSecret:    webhookSecret,
		R2:           r2Client,
	})
	purge.RegisterRoutes(app, webhookSecret, purge.Config{
		GitHubClient: wcfg.GitHubClient,
		GitHubOwner:  ghOwner,
		GitHubBranch: env.Get("GITHUB_BRANCH", "main"),
		R2:           r2Client,
		Log:          appLog,
	})

	// Liveness/readiness probe. Public, no auth: Docker/compose healthchecks and
	// load balancers hit GET /health. Without this the catch-all 404s the probe
	// and the container is reported unhealthy.
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	if env.IsDev() {
		testpage.RegisterRoutes(app)
	}

	// Unmatched routes only (must be registered after all real routes).
	app.Use(func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"message": "This endpoint is not available",
		})
	})

	port := env.Get("PORT", "3003")

	go func() {
		if err := app.Listen(":" + port); err != nil {
			log.Printf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	appLog.Infof("shutting down")
	pool.Stop()
	_ = app.Shutdown()
}
