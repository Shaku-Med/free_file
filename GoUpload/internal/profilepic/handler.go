package profilepic

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"io"
	"math"
	"path/filepath"
	"strings"
	"time"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/gofiber/fiber/v2"
	"github.com/google/go-github/v62/github"
	_ "golang.org/x/image/webp"

	"goupload/internal/middleware"
	"goupload/lib/ffmpeg"
	ghlib "goupload/lib/github"
	"goupload/lib/imagegate"
	"goupload/lib/logger"
	"goupload/lib/nsfw"
	"goupload/lib/nsfwstrikes"
	"goupload/lib/quota"
	"goupload/lib/r2"
	"goupload/lib/security"
	"goupload/lib/supabase"
)

const maxFileSize = 10 << 20

const nsfwGifFrameSamples = 5

var allowedMIME = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

var extByMIME = map[string]string{
	"image/jpeg": ".jpg",
	"image/jpg":  ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

type Handler struct {
	log            *logger.Logger
	nsfw           *nsfw.Detector
	strikes        *nsfwstrikes.Limiter
	ghCli          *github.Client
	ghOwner        string
	ghRepo         string
	supabaseURL    string
	supabaseKey    string
	r2             *r2.Client
	storageBackend string
}

type Config struct {
	GitHubClient  *github.Client
	GitHubOwner   string
	GitHubRepo    string
	NSFWApiURL    string
	NSFWApiSecret string
	Strikes       *nsfwstrikes.Limiter
	// Optional: when set, profile pics use users.github_repo when non-empty; otherwise
	// GITHUB_REPO and we PATCH users.github_repo to that default.
	SupabaseURL string
	SupabaseKey string
	// R2 dual-backend: when StorageBackend == "r2" and R2 is set, new profile
	// pics go to R2 and users.storage_backend is set to 'r2'.
	R2             *r2.Client
	StorageBackend string
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, cfg Config) {
	h := &Handler{
		log:            log,
		nsfw:           nsfw.NewDetector(cfg.NSFWApiURL, cfg.NSFWApiSecret),
		strikes:        cfg.Strikes,
		ghCli:          cfg.GitHubClient,
		ghOwner:        cfg.GitHubOwner,
		ghRepo:         cfg.GitHubRepo,
		supabaseURL:    strings.TrimSpace(cfg.SupabaseURL),
		supabaseKey:    strings.TrimSpace(cfg.SupabaseKey),
		r2:             cfg.R2,
		storageBackend: cfg.StorageBackend,
	}
	app.Post("/api/profilepic/upload", h.upload)
}

func (h *Handler) useR2() bool {
	return h.storageBackend == "r2" && h.r2 != nil
}

func (h *Handler) upload(c *fiber.Ctx) error {
	// Bound the CPU work these inline handlers do so a burst cannot starve the
	// video pipeline. Queued uploads are limited by the worker pool instead.
	if !imagegate.Acquire(c.UserContext()) {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "error": "busy"})
	}
	defer imagegate.Release()

	uid, ok := c.Locals(middleware.LocalsUserID).(string)
	if !ok || uid == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
	}
	username, uok := c.Locals(middleware.LocalsUsername).(string)
	if !uok || username == "" || !security.IsValidUsername(username) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false})
	}

	if h.strikes != nil && h.strikes.RespondIfBlocked(c, uid) {
		return nil
	}

	file, err := c.FormFile("file")
	if err != nil || file == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}

	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}

	mime := strings.ToLower(strings.TrimSpace(file.Header.Get("Content-Type")))
	if !allowedMIME[mime] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}

	f, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}
	defer f.Close()

	// Don't trust the multipart header size: bound the actual read so a client
	// can't claim a small size and stream up to the global BodyLimit.
	data, err := io.ReadAll(io.LimitReader(f, maxFileSize+1))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}
	if int64(len(data)) > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}
	ar := float64(cfg.Width) / float64(cfg.Height)
	if math.Abs(ar-1.0) > 0.001 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}
	if cfg.Width > 8192 || cfg.Height > 8192 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}

	var toScan [][]byte
	if strings.EqualFold(mime, "image/gif") {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		frames, serr := ffmpeg.SampleGIFForVision(ctx, data, nsfwGifFrameSamples)
		cancel()
		if serr != nil {
			h.log.Errorf("profilepic gif NSFW sample: %v", serr)
			toScan = [][]byte{data}
		} else {
			toScan = frames
		}
	} else {
		toScan = [][]byte{data}
	}

	if len(toScan) == 1 {
		result, err := h.nsfw.Detect(toScan[0])
		if err != nil {
			h.log.Errorf("profilepic NSFW check error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		if result.IsNSFW {
			if h.strikes != nil {
				if err := h.strikes.RecordDeniedNSFWBestEffort(context.Background(), uid); err != nil {
					h.log.Errorf("profilepic nsfw strike record: %v", err)
				}
			}
			return c.Status(422).JSON(fiber.Map{"success": false, "nsfw": true})
		}
	} else {
		anyNsfw, _, err := h.nsfw.DetectBatch(toScan)
		if err != nil {
			h.log.Errorf("profilepic NSFW batch check error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		if anyNsfw {
			if h.strikes != nil {
				if err := h.strikes.RecordDeniedNSFWBestEffort(context.Background(), uid); err != nil {
					h.log.Errorf("profilepic nsfw strike record: %v", err)
				}
			}
			return c.Status(422).JSON(fiber.Map{"success": false, "nsfw": true})
		}
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext == "" || ext == "." {
		ext = extByMIME[mime]
	}
	if ext == "" {
		ext = ".jpg"
	}
	switch ext {
	case ".jpeg", ".jpg", ".png", ".gif", ".webp":
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"success": false})
	}

	ghPath := fmt.Sprintf("%s/%s%s", username, uid, ext)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// R2 path: upload + mark users.storage_backend so the loader presigns R2.
	if h.useR2() {
		if err := h.r2.PutObject(ctx, ghPath, data, mime); err != nil {
			h.log.Errorf("profilepic R2 upload failed: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
		}
		if h.supabaseURL != "" && h.supabaseKey != "" {
			if err := supabase.SetUserStorageBackend(ctx, h.supabaseURL, h.supabaseKey, uid, "r2"); err != nil {
				h.log.Errorf("profilepic set users.storage_backend: %v", err)
			}
		}
		h.log.Infof("profilepic uploaded backend=r2 user=%s path=%s", uid, ghPath)
		go quota.Record(context.Background(), uid, fmt.Sprintf("pic_%s_%d", uid, time.Now().UnixNano()), int64(len(data)))
		return c.JSON(fiber.Map{
			"success":         true,
			"profile_pic":     ghPath,
			"storage_backend": "r2",
		})
	}

	if h.ghCli == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}

	targetRepo := strings.TrimSpace(h.ghRepo)

	if h.supabaseURL != "" && h.supabaseKey != "" {
		stored, ferr := supabase.FetchUserGithubRepo(ctx, h.supabaseURL, h.supabaseKey, uid)
		if ferr != nil {
			h.log.Errorf("profilepic fetch github_repo: %v", ferr)
			targetRepo = strings.TrimSpace(h.ghRepo)
		} else if stored != "" && supabase.ValidGitHubRepoName(stored) {
			targetRepo = stored
		} else {
			targetRepo = strings.TrimSpace(h.ghRepo)
		}
	}

	if targetRepo == "" || !supabase.ValidGitHubRepoName(targetRepo) {
		h.log.Errorf("profilepic target repo empty or invalid")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}

	if err := ghlib.CreateOrUpdateFile(ctx, h.ghCli, h.ghOwner, targetRepo, ghPath, data, fmt.Sprintf("Profile picture for %s", username)); err != nil {
		h.log.Errorf("profilepic GitHub upload failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"success": false})
	}

	// Always persist the repo we wrote to so users.github_repo matches GitHub (loader + cleanup use it).
	if h.supabaseURL != "" && h.supabaseKey != "" {
		if err := supabase.SetUserGithubRepo(ctx, h.supabaseURL, h.supabaseKey, uid, targetRepo); err != nil {
			h.log.Errorf("profilepic set users.github_repo: %v", err)
		}
		if err := supabase.SetUserStorageBackend(ctx, h.supabaseURL, h.supabaseKey, uid, "github"); err != nil {
			h.log.Errorf("profilepic set users.storage_backend: %v", err)
		}
	}

	h.log.Infof("profilepic uploaded backend=github user=%s repo=%s path=%s", uid, targetRepo, ghPath)
	go quota.Record(context.Background(), uid, fmt.Sprintf("pic_%s_%d", uid, time.Now().UnixNano()), int64(len(data)))

	return c.JSON(fiber.Map{
		"success":     true,
		"profile_pic": ghPath,
		"github_repo": targetRepo,
	})
}
