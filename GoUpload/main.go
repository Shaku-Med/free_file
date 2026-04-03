package main

import (
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"goupload/internal/commentimg"
	"goupload/internal/middleware"
	"goupload/internal/testpage"
	"goupload/internal/thumbnail"
	"goupload/internal/upload"
	"goupload/internal/worker"
	"goupload/lib/env"
	ghlib "goupload/lib/github"
	"goupload/lib/logger"
	"goupload/lib/queue"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
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

	ghToken := env.Get("GITHUB_TOKEN", "")
	ghOwner := env.Get("GITHUB_OWNER", "")
	ghRepo := strings.TrimSpace(env.Get("GITHUB_REPO", ""))
	log.Println("ghRepo", ghRepo)
	if ghToken != "" && ghOwner != "" && ghRepo == "" {
		log.Fatal("GITHUB_REPO must be set when GITHUB_TOKEN and GITHUB_OWNER are set")
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
	}
	if ghToken != "" && ghOwner != "" {
		wcfg.GitHubClient = ghlib.NewClient(ghlib.Config{Token: ghToken, Owner: ghOwner, Repo: ghRepo})
	}
	w := worker.New(q, appLog, wcfg)
	w.Start()

	app := fiber.New(fiber.Config{
		BodyLimit:      int(upload.ChunkSizeBytes),
		ReadBufferSize: 1024 * 1024,
		ReadTimeout:    90 * time.Second,
		WriteTimeout:   90 * time.Second,
		IdleTimeout:    60 * time.Second,
	})

	// CORS: allow app origin for browser uploads
	corsOrigins := env.Get("CORS_ORIGINS", env.Get("APP_BASE_URL", "http://localhost:3000"))
	if corsOrigins == "" {
		corsOrigins = "*"
	}
	origins := corsOrigins

	app.Use(cors.New(cors.Config{
		AllowOriginsFunc: func(origin string) bool {
			if env.IsDev() {
				return true
			}
			if origins == "*" {
				return true
			}
			for _, o := range strings.Split(origins, ",") {
				if strings.TrimSpace(o) == origin {
					return true
				}
			}
			return false
		},
		AllowMethods:     "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
		AllowHeaders:     "Accept, Authorization, Content-Type, X-Upload-ID, X-Chunk-Index, X-User-ID",
		AllowCredentials: true,
		MaxAge:           600,
	}))

	app.Use("/api/upload", middleware.AuthUpload())
	app.Use("/api/thumbnail", middleware.AuthUpload())
	app.Use("/api/comment-image", middleware.AuthUpload())
	upload.RegisterRoutes(app, manager, q, appLog)
	thumbnail.RegisterRoutes(app, appLog, thumbnail.Config{
		GitHubClient:  wcfg.GitHubClient,
		GitHubOwner:   ghOwner,
		GitHubRepo:    ghRepo,
		NSFWApiURL:    nsfwAPI,
		NSFWApiSecret: webhookSecret,
	})
	commentimg.RegisterRoutes(app, appLog, commentimg.Config{
		GitHubClient:  wcfg.GitHubClient,
		GitHubOwner:   ghOwner,
		GitHubRepo:    ghRepo,
		NSFWApiURL:    nsfwAPI,
		NSFWApiSecret: webhookSecret,
	})
	if env.IsDev() {
		testpage.RegisterRoutes(app)
	}

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
	w.Stop()
	_ = app.Shutdown()
}
