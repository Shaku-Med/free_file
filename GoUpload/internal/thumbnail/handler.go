package thumbnail

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "image/gif"
	_ "image/png"

	_ "golang.org/x/image/webp"

	"github.com/gofiber/fiber/v2"
	"github.com/google/go-github/v62/github"
	"goupload/lib/ffmpeg"
	ghlib "goupload/lib/github"
	"goupload/lib/imagegate"
	"goupload/lib/logger"
	"goupload/lib/nsfw"
	"goupload/lib/nsfwstrikes"
	"goupload/lib/quota"
	"goupload/lib/r2"
	"goupload/lib/supabase"
)

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

type Handler struct {
	log           *logger.Logger
	nsfw          *nsfw.Detector
	strikes       *nsfwstrikes.Limiter
	ghCli         *github.Client
	ghOwner       string
	ghRepo        string
	assembledRoot string // local-only video files for /extract (user subdir enforced)
	r2            *r2.Client
	supabaseURL   string
	supabaseKey   string
}

type Config struct {
	GitHubClient  *github.Client
	GitHubOwner   string
	GitHubRepo    string
	NSFWApiURL    string
	NSFWApiSecret string
	Strikes       *nsfwstrikes.Limiter
	// AssembledRoot is the directory where completed uploads are written (e.g. upload/assembled).
	// /api/thumbnail/extract only reads videos under AssembledRoot/<userID>/...
	AssembledRoot string
	// R2 dual-backend: a custom default thumbnail follows its video's backend,
	// looked up from files.storage_backend via Supabase.
	R2          *r2.Client
	SupabaseURL string
	SupabaseKey string
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, cfg Config) {
	h := &Handler{
		log:           log,
		nsfw:          nsfw.NewDetector(cfg.NSFWApiURL, cfg.NSFWApiSecret),
		strikes:       cfg.Strikes,
		ghCli:         cfg.GitHubClient,
		ghOwner:       cfg.GitHubOwner,
		ghRepo:        cfg.GitHubRepo,
		assembledRoot: strings.TrimSpace(cfg.AssembledRoot),
		r2:            cfg.R2,
		supabaseURL:   strings.TrimSpace(cfg.SupabaseURL),
		supabaseKey:   strings.TrimSpace(cfg.SupabaseKey),
	}
	app.Post("/api/thumbnail/extract", h.extractAtTimestamp)
	app.Post("/api/thumbnail/upload", h.uploadDefaultThumbnail)
}

type extractRequest struct {
	VideoPath string  `json:"video_path"`
	Timestamp float64 `json:"timestamp"`
}

func (h *Handler) safeAssembledVideoPath(uid, videoPath string) (string, error) {
	if h.assembledRoot == "" {
		return "", errors.New("assembled root not configured")
	}
	if uid == "" || videoPath == "" {
		return "", errors.New("empty path")
	}
	userBase, err := filepath.Abs(filepath.Join(h.assembledRoot, uid))
	if err != nil {
		return "", err
	}
	var candidate string
	if filepath.IsAbs(videoPath) {
		candidate = filepath.Clean(videoPath)
	} else {
		candidate = filepath.Clean(filepath.Join(userBase, videoPath))
	}
	absCand, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(userBase, absCand)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("path outside user assembled directory")
	}
	st, err := os.Stat(absCand)
	if err != nil {
		return "", err
	}
	if st.IsDir() {
		return "", errors.New("not a regular file")
	}
	return absCand, nil
}

func (h *Handler) extractAtTimestamp(c *fiber.Ctx) error {
	// Bound the CPU work these inline handlers do so a burst cannot starve the
	// video pipeline. Queued uploads are limited by the worker pool instead.
	if !imagegate.Acquire(c.UserContext()) {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "error": "busy"})
	}
	defer imagegate.Release()

	uid, ok := c.Locals("userID").(string)
	if !ok || uid == "" {
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

	videoFile, err := h.safeAssembledVideoPath(uid, req.VideoPath)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid video_path"})
	}

	outDir := filepath.Join("upload", "thumbnails", "custom")
	if err := os.MkdirAll(outDir, 0700); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create output dir"})
	}

	outFile := filepath.Join(outDir, fmt.Sprintf("thumb_%s_%d.jpg", uid, time.Now().UnixMilli()))

	ts := strconv.FormatFloat(req.Timestamp, 'f', 2, 64)
	args := []string{
		"-nostdin",
		"-hide_banner",
		"-loglevel", "error",
		"-ss", ts,
		"-i", videoFile,
		"-vframes", "1",
		"-q:v", "2",
		"-y",
		outFile,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := ffmpeg.FFmpegCommand(ctx, args...)
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
	// Bound the CPU work these inline handlers do so a burst cannot starve the
	// video pipeline. Queued uploads are limited by the worker pool instead.
	if !imagegate.Acquire(c.UserContext()) {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "error": "busy"})
	}
	defer imagegate.Release()

	userID := c.Locals("userID")
	uid, ok := userID.(string)
	if !ok || uid == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}

	uniqueId := strings.TrimSpace(c.FormValue("unique_id"))
	if uniqueId == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "unique_id is required"})
	}
	if !isSafeUniqueIDSegment(uniqueId) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid unique_id"})
	}

	dateFolder := strings.TrimSpace(c.FormValue("date_folder"))
	if dateFolder == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "date_folder is required"})
	}
	if !reDateFolder.MatchString(dateFolder) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid date_folder"})
	}

	fileType := c.FormValue("file_type")
	if strings.HasPrefix(strings.ToLower(fileType), "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "thumbnail cannot be changed for image files"})
	}

	// IDOR guard: only the file's owner may overwrite its default thumbnail.
	// The app proxy checks this, but a caller with a valid bearer can hit the
	// upload server directly, so we re-verify ownership here. When Supabase
	// isn't configured (local dev) we skip the check to keep dev working.
	if h.supabaseURL != "" && h.supabaseKey != "" {
		ownCtx, ownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		own, oerr := supabase.FetchFileOwnership(ownCtx, h.supabaseURL, h.supabaseKey, uniqueId)
		ownCancel()
		if oerr != nil {
			h.log.Errorf("thumbnail ownership lookup: %v", oerr)
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "ownership check failed"})
		}
		if !own.Found {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
		}
		if own.OwnerID == "" || own.OwnerID != uid {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "forbidden"})
		}
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

	// Bound the actual read; the multipart header size is client-supplied.
	const maxThumbBytes = 10 << 20
	data, err := io.ReadAll(io.LimitReader(f, maxThumbBytes+1))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}
	if len(data) > maxThumbBytes {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "file exceeds 10MB limit"})
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

	ghPath := fmt.Sprintf("%s/%s/default_thumbnail.jpg", dateFolder, uniqueId)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Follow the parent video's backend so the thumbnail reads from the same place.
	backend := "github"
	if h.supabaseURL != "" && h.supabaseKey != "" {
		if fb, ferr := supabase.FetchFileStorageBackend(ctx, h.supabaseURL, h.supabaseKey, uniqueId); ferr == nil {
			backend = fb
		} else {
			h.log.Errorf("thumbnail parent backend lookup: %v", ferr)
		}
	}

	if backend == "r2" && h.r2 != nil {
		if err := h.r2.PutObject(ctx, ghPath, jpegBytes, "image/jpeg"); err != nil {
			h.log.Errorf("thumbnail R2 upload failed: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
		}
	} else {
		if h.ghCli == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "storage not configured"})
		}
		if err := ghlib.CreateOrUpdateFile(ctx, h.ghCli, h.ghOwner, h.ghRepo, ghPath, jpegBytes, fmt.Sprintf("Default thumbnail for %s", uniqueId)); err != nil {
			h.log.Errorf("thumbnail GitHub upload failed: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
		}
	}

	h.log.Infof("default thumbnail uploaded backend=%s user=%s path=%s", backend, uid, ghPath)
	go quota.Record(context.Background(), uid, fmt.Sprintf("thumb_%s_%d", uniqueId, time.Now().UnixNano()), int64(len(jpegBytes)))

	return c.JSON(fiber.Map{
		"success":           true,
		"default_thumbnail": ghPath,
	})
}
