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
	"goupload/lib/logger"
	"goupload/lib/nsfw"
	"goupload/lib/nsfwstrikes"
	"goupload/lib/security"
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
	log     *logger.Logger
	nsfw    *nsfw.Detector
	strikes *nsfwstrikes.Limiter
	ghCli   *github.Client
	ghOwner string
	ghRepo  string
}

type Config struct {
	GitHubClient  *github.Client
	GitHubOwner   string
	GitHubRepo    string
	NSFWApiURL    string
	NSFWApiSecret string
	Strikes       *nsfwstrikes.Limiter
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, cfg Config) {
	h := &Handler{
		log:     log,
		nsfw:    nsfw.NewDetector(cfg.NSFWApiURL, cfg.NSFWApiSecret),
		strikes: cfg.Strikes,
		ghCli:   cfg.GitHubClient,
		ghOwner: cfg.GitHubOwner,
		ghRepo:  cfg.GitHubRepo,
	}
	app.Post("/api/profilepic/upload", h.upload)
}

func (h *Handler) upload(c *fiber.Ctx) error {
	uid, ok := c.Locals(middleware.LocalsUserID).(string)
	if !ok || uid == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}
	username, uok := c.Locals(middleware.LocalsUsername).(string)
	if !uok || username == "" || !security.IsValidUsername(username) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid_profile_session"})
	}

	if h.strikes != nil && h.strikes.RespondIfBlocked(c, uid) {
		return nil
	}

	file, err := c.FormFile("file")
	if err != nil || file == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no file provided"})
	}

	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "file exceeds 10MB limit"})
	}

	mime := strings.ToLower(strings.TrimSpace(file.Header.Get("Content-Type")))
	if !allowedMIME[mime] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file type, must be an image"})
	}

	f, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "could not read image dimensions"})
	}
	if cfg.Width < 1 || cfg.Height < 1 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid image dimensions"})
	}
	ar := float64(cfg.Width) / float64(cfg.Height)
	if math.Abs(ar-1.0) > 0.001 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "profile picture must be square (1:1 aspect ratio)"})
	}
	if cfg.Width > 8192 || cfg.Height > 8192 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "image dimensions too large"})
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
		} else if result.IsNSFW {
			if h.strikes != nil {
				if err := h.strikes.RecordDeniedNSFWBestEffort(context.Background(), uid); err != nil {
					h.log.Errorf("profilepic nsfw strike record: %v", err)
				}
			}
			return c.Status(422).JSON(fiber.Map{
				"error": "This image was detected as inappropriate and cannot be used as a profile picture",
				"nsfw":  true,
			})
		}
	} else {
		anyNsfw, _, err := h.nsfw.DetectBatch(toScan)
		if err != nil {
			h.log.Errorf("profilepic NSFW batch check error: %v", err)
		} else if anyNsfw {
			if h.strikes != nil {
				if err := h.strikes.RecordDeniedNSFWBestEffort(context.Background(), uid); err != nil {
					h.log.Errorf("profilepic nsfw strike record: %v", err)
				}
			}
			return c.Status(422).JSON(fiber.Map{
				"error": "This image was detected as inappropriate and cannot be used as a profile picture",
				"nsfw":  true,
			})
		}
	}

	if h.ghCli == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "storage not configured"})
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "unsupported file extension"})
	}

	ghPath := fmt.Sprintf("%s/%s%s", username, uid, ext)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := ghlib.CreateOrUpdateFile(ctx, h.ghCli, h.ghOwner, h.ghRepo, ghPath, data, fmt.Sprintf("Profile picture for %s", username)); err != nil {
		h.log.Errorf("profilepic GitHub upload failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
	}

	h.log.Infof("profilepic uploaded user=%s path=%s", uid, ghPath)

	return c.JSON(fiber.Map{
		"success":     true,
		"profile_pic": ghPath,
	})
}
