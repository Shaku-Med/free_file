package commentimg

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"goupload/lib/ffmpeg"
	"goupload/lib/logger"
	ghlib "goupload/lib/github"
	"goupload/lib/nsfw"

	"github.com/gofiber/fiber/v2"
	"github.com/google/go-github/v62/github"
	"github.com/google/uuid"
)

// Inline comment images; app proxy uses the same cap.
const maxFileSize = 10 << 20 // 10 MiB

// Spread NSFW checks across evenly spaced frames (same idea as video thumbnail sampling).
const nsfwGifFrameSamples = 5

var reDateFolder = regexp.MustCompile(`^\d{2}_\d{2}_\d{4}$`)

func isSafeUniqueIDSegment(s string) bool {
	const max = 128
	if len(s) == 0 || len(s) > max {
		return false
	}
	if strings.Contains(s, "..") || strings.Contains(s, "/") || strings.Contains(s, "\\") {
		return false
	}
	for _, r := range s {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}

var allowedMIME = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

type Handler struct {
	log     *logger.Logger
	nsfw    *nsfw.Detector
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
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, cfg Config) {
	h := &Handler{
		log:     log,
		nsfw:    nsfw.NewDetector(cfg.NSFWApiURL, cfg.NSFWApiSecret),
		ghCli:   cfg.GitHubClient,
		ghOwner: cfg.GitHubOwner,
		ghRepo:  cfg.GitHubRepo,
	}
	app.Post("/api/comment-image/upload", h.upload)
}

func (h *Handler) upload(c *fiber.Ctx) error {
	userID := c.Locals("userID")
	uid, ok := userID.(string)
	if !ok || uid == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}

	file, err := c.FormFile("file")
	if err != nil || file == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no file provided"})
	}

	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "file exceeds 10MB limit"})
	}

	mime := file.Header.Get("Content-Type")
	if !allowedMIME[strings.ToLower(mime)] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file type"})
	}

	// Read file bytes
	f, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}

	// NSFW check — animated GIFs: sample frames as PNG via ffmpeg and scan each (raw GIF often only checks first frame or fails downstream).
	var toScan [][]byte
	if strings.EqualFold(mime, "image/gif") {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		frames, serr := ffmpeg.SampleGIFForVision(ctx, data, nsfwGifFrameSamples)
		cancel()
		if serr != nil {
			h.log.Errorf("comment-image gif sample for NSFW: %v", serr)
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
			h.log.Errorf("comment-image NSFW check error: %v", err)
		} else if result.IsNSFW {
			return c.Status(422).JSON(fiber.Map{
				"error": "This image was detected as inappropriate and cannot be posted in comments",
				"nsfw":  true,
			})
		}
	} else {
		anyNsfw, _, err := h.nsfw.DetectBatch(toScan)
		if err != nil {
			h.log.Errorf("comment-image NSFW batch check error: %v", err)
		} else if anyNsfw {
			return c.Status(422).JSON(fiber.Map{
				"error": "This image was detected as inappropriate and cannot be posted in comments",
				"nsfw":  true,
			})
		}
	}

	// Upload to GitHub via Contents API
	if h.ghCli == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "storage not configured"})
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext == "" {
		ext = ".jpg"
	}
	imageID := uuid.New().String()

	dateFolder := strings.TrimSpace(c.FormValue("date_folder"))
	uniqueID := strings.TrimSpace(c.FormValue("unique_id"))
	var ghPath string
	if dateFolder != "" && uniqueID != "" &&
		reDateFolder.MatchString(dateFolder) && isSafeUniqueIDSegment(uniqueID) {
		// Same repo layout as the parent upload: DD_MM_YYYY / unique_id / comments / …
		ghPath = fmt.Sprintf("%s/%s/comments/%s%s", dateFolder, uniqueID, imageID, ext)
	} else {
		ghPath = fmt.Sprintf("comment-images/%s/%s%s", uid, imageID, ext)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := ghlib.CreateOrUpdateFile(ctx, h.ghCli, h.ghOwner, h.ghRepo, ghPath, data, fmt.Sprintf("Comment image by %s", uid)); err != nil {
		h.log.Errorf("comment-image GitHub upload failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
	}

	h.log.Infof("comment-image uploaded user=%s path=%s", uid, ghPath)

	return c.JSON(fiber.Map{
		"success": true,
		"image": fiber.Map{
			"url":  ghPath,
			"type": mime,
			"size": file.Size,
		},
	})
}
