package thumbnail

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "image/gif"
	_ "image/png"

	_ "golang.org/x/image/webp"

	"github.com/gofiber/fiber/v2"
	"github.com/google/go-github/v62/github"
	ghlib "goupload/lib/github"
	"goupload/lib/logger"
	"goupload/lib/nsfw"
	"goupload/lib/nsfwstrikes"
)

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
	app.Post("/api/thumbnail/extract", h.extractAtTimestamp)
	app.Post("/api/thumbnail/upload", h.uploadDefaultThumbnail)
}

type extractRequest struct {
	VideoPath string  `json:"video_path"`
	Timestamp float64 `json:"timestamp"`
}

func (h *Handler) extractAtTimestamp(c *fiber.Ctx) error {
	userID := c.Locals("userID")
	if userID == nil || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}

	var req extractRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_body"})
	}

	if req.VideoPath == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "video_path required"})
	}
	if req.Timestamp < 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid timestamp"})
	}

	outDir := filepath.Join("upload", "thumbnails", "custom")
	if err := os.MkdirAll(outDir, 0700); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create output dir"})
	}

	outFile := filepath.Join(outDir, fmt.Sprintf("thumb_%s_%d.jpg", userID, time.Now().UnixMilli()))

	ts := strconv.FormatFloat(req.Timestamp, 'f', 2, 64)
	args := []string{
		"-ss", ts,
		"-i", req.VideoPath,
		"-vframes", "1",
		"-q:v", "2",
		"-y",
		outFile,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "thumbnail extraction failed"})
	}

	data, err := os.ReadFile(outFile)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read thumbnail"})
	}

	defer os.Remove(outFile)

	c.Set("Content-Type", "image/jpeg")
	c.Set("Content-Disposition", "inline; filename=thumbnail.jpg")
	return c.Send(data)
}

var allowedMIME = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

func (h *Handler) uploadDefaultThumbnail(c *fiber.Ctx) error {
	userID := c.Locals("userID")
	uid, ok := userID.(string)
	if !ok || uid == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}

	uniqueId := c.FormValue("unique_id")
	if uniqueId == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "unique_id is required"})
	}

	dateFolder := c.FormValue("date_folder")
	if dateFolder == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "date_folder is required"})
	}

	fileType := c.FormValue("file_type")
	if strings.HasPrefix(strings.ToLower(fileType), "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "thumbnail cannot be changed for image files"})
	}

	isAdultStr := c.FormValue("is_adult")
	isAdult := isAdultStr == "true" || isAdultStr == "1"

	if !isAdult && h.strikes != nil && h.strikes.RespondIfBlocked(c, uid) {
		return nil
	}

	file, err := c.FormFile("file")
	if err != nil || file == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no file provided"})
	}

	if file.Size > 10<<20 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "file exceeds 10MB limit"})
	}

	mime := file.Header.Get("Content-Type")
	if !allowedMIME[strings.ToLower(mime)] {
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

	result, err := h.nsfw.Detect(data)
	if err != nil {
		h.log.Errorf("thumbnail NSFW check error: %v", err)
	} else if result.IsNSFW && !isAdult {
		if h.strikes != nil {
			if err := h.strikes.RecordDeniedNSFWBestEffort(context.Background(), uid); err != nil {
				h.log.Errorf("thumbnail nsfw strike record: %v", err)
			}
		}
		return c.Status(422).JSON(fiber.Map{
			"error": "This thumbnail was detected as inappropriate content. It cannot be used for a non-adult file.",
			"nsfw":  true,
		})
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "could not decode image; use JPEG, PNG, GIF, or WebP"})
	}
	b := img.Bounds()
	if b.Dx() > 8192 || b.Dy() > 8192 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "image dimensions too large"})
	}
	var jpegBuf bytes.Buffer
	if err := jpeg.Encode(&jpegBuf, img, &jpeg.Options{Quality: 88}); err != nil {
		h.log.Errorf("thumbnail JPEG encode failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to process image"})
	}
	jpegBytes := jpegBuf.Bytes()

	if h.ghCli == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "storage not configured"})
	}

	ghPath := fmt.Sprintf("%s/%s/default_thumbnail.jpg", dateFolder, uniqueId)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := ghlib.CreateOrUpdateFile(ctx, h.ghCli, h.ghOwner, h.ghRepo, ghPath, jpegBytes, fmt.Sprintf("Default thumbnail for %s", uniqueId)); err != nil {
		h.log.Errorf("thumbnail GitHub upload failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
	}

	h.log.Infof("default thumbnail uploaded user=%s path=%s", uid, ghPath)

	return c.JSON(fiber.Map{
		"success":           true,
		"default_thumbnail": ghPath,
	})
}
