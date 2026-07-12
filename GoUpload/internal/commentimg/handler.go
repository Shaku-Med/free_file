package commentimg

import (
	"context"
	"crypto/subtle"
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
	"goupload/lib/nsfwstrikes"
	"goupload/lib/quota"
	"goupload/lib/r2"
	"goupload/lib/supabase"
	"goupload/lib/webhook"

	"github.com/gofiber/fiber/v2"
	"github.com/google/go-github/v62/github"
	"github.com/google/uuid"
)

const maxFileSize = 10 << 20
const nsfwGifFrameSamples = 5

var reDateFolder = regexp.MustCompile(`^\d{2}_\d{2}_\d{4}$`)

// The only two comment-image path shapes we ever store, so the internal delete
// can never be pointed at anything else even if the shared secret leaked.
var reStandaloneCommentPath = regexp.MustCompile(`^comment-images/[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9]{1,8}$`)
var reVideoCommentPath = regexp.MustCompile(`^\d{2}_\d{2}_\d{4}/[A-Za-z0-9_-]{1,128}/comments/[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9]{1,8}$`)
var reDeleteRepo = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)

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
	log            *logger.Logger
	nsfw           *nsfw.Detector
	strikes        *nsfwstrikes.Limiter
	ghCli          *github.Client
	ghOwner        string
	ghRepo         string
	r2             *r2.Client
	storageBackend string
	supabaseURL    string
	supabaseKey    string
	webhookSecret  string
}

type Config struct {
	GitHubClient  *github.Client
	GitHubOwner   string
	GitHubRepo    string
	NSFWApiURL    string
	NSFWApiSecret string
	Strikes       *nsfwstrikes.Limiter
	// R2 dual-backend. Standalone comment images use StorageBackend; images
	// under a video's folder follow that file's backend (looked up via Supabase).
	R2             *r2.Client
	StorageBackend string
	SupabaseURL    string
	SupabaseKey    string
	// Shared server-to-server secret for the internal delete route.
	WebhookSecret string
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, cfg Config) {
	h := &Handler{
		log:            log,
		nsfw:           nsfw.NewDetector(cfg.NSFWApiURL, cfg.NSFWApiSecret),
		strikes:        cfg.Strikes,
		ghCli:          cfg.GitHubClient,
		ghOwner:        cfg.GitHubOwner,
		ghRepo:         cfg.GitHubRepo,
		r2:             cfg.R2,
		storageBackend: cfg.StorageBackend,
		supabaseURL:    strings.TrimSpace(cfg.SupabaseURL),
		supabaseKey:    strings.TrimSpace(cfg.SupabaseKey),
		webhookSecret:  strings.TrimSpace(cfg.WebhookSecret),
	}
	app.Post("/api/comment-image/upload", h.upload)
	// Server-to-server only (X-Webhook-Secret): purge one comment image when its
	// comment is deleted. NOT under the /api/comment-image bearer-auth prefix.
	app.Post("/internal/comment-image/delete", h.deleteInternal)
}

func (h *Handler) deleteInternal(c *fiber.Ctx) error {
	if h.webhookSecret == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
	}
	if subtle.ConstantTimeCompare([]byte(c.Get("X-Webhook-Secret")), []byte(h.webhookSecret)) != 1 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}

	var body struct {
		Path    string `json:"path"`
		Repo    string `json:"repo"`
		Backend string `json:"backend"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
	}
	path := strings.TrimSpace(body.Path)
	if strings.Contains(path, "..") ||
		(!reStandaloneCommentPath.MatchString(path) && !reVideoCommentPath.MatchString(path)) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if body.Backend == "r2" {
		if h.r2 == nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}
		if err := h.r2.DeleteObject(ctx, path); err != nil {
			h.log.Errorf("comment-image r2 delete failed path=%s: %v", path, err)
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "delete_failed"})
		}
		return c.JSON(fiber.Map{"ok": true})
	}

	if h.ghCli == nil || h.ghOwner == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
	}
	repo := strings.TrimSpace(body.Repo)
	if !reDeleteRepo.MatchString(repo) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
	}
	if err := ghlib.DeleteFile(ctx, h.ghCli, h.ghOwner, repo, path, "Remove deleted comment image"); err != nil {
		// Keep the storage location out of logs, same rule as /internal/purge.
		msg := err.Error()
		msg = strings.ReplaceAll(msg, h.ghOwner+"/"+repo, "archive")
		msg = strings.ReplaceAll(msg, repo, "archive")
		if h.ghOwner != "" {
			msg = strings.ReplaceAll(msg, h.ghOwner, "archive")
		}
		h.log.Errorf("comment-image github delete failed path=%s: %s", path, msg)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "delete_failed"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) upload(c *fiber.Ctx) error {
	userID := c.Locals("userID")
	uid, ok := userID.(string)
	if !ok || uid == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_user_id"})
	}

	isAdultStr := strings.TrimSpace(c.FormValue("is_adult"))
	isAdult := isAdultStr == "true" || isAdultStr == "1"
	dateFolder := strings.TrimSpace(c.FormValue("date_folder"))
	uniqueID := strings.TrimSpace(c.FormValue("unique_id"))

	// Browser uploads send file_id only; resolve folder metadata server-side.
	fileID := strings.TrimSpace(c.FormValue("file_id"))
	if fileID != "" {
		if h.supabaseURL == "" || h.supabaseKey == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "policy check unavailable"})
		}
		metaCtx, metaCancel := context.WithTimeout(context.Background(), 10*time.Second)
		meta, merr := supabase.FetchFileCommentMeta(metaCtx, h.supabaseURL, h.supabaseKey, fileID)
		metaCancel()
		if merr != nil {
			h.log.Errorf("comment-image file_id lookup: %v", merr)
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "policy check failed"})
		}
		if !meta.Found {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
		}
		if !meta.CommentsEnabled {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "comments are disabled for this file"})
		}
		if meta.UniqueID != "" {
			uniqueID = meta.UniqueID
		}
		if meta.DateFolder != "" {
			dateFolder = meta.DateFolder
		}
		if meta.IsAdult {
			isAdult = true
		}
	}

	if !isAdult && h.strikes != nil && h.strikes.RespondIfBlocked(c, uid) {
		return nil
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

	f, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}
	defer f.Close()

	// Bound the actual read; the multipart header size is client-supplied.
	data, err := io.ReadAll(io.LimitReader(f, maxFileSize+1))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read file"})
	}
	if int64(len(data)) > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "file exceeds 10MB limit"})
	}

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
		} else if result.IsNSFW && !isAdult {
			if h.strikes != nil {
				if err := h.strikes.RecordDeniedNSFWBestEffort(context.Background(), uid); err != nil {
					h.log.Errorf("comment-image nsfw strike record: %v", err)
				}
			}
			return c.Status(422).JSON(fiber.Map{
				"error": "This image was detected as inappropriate and cannot be posted in comments",
				"nsfw":  true,
			})
		}
	} else {
		anyNsfw, _, err := h.nsfw.DetectBatch(toScan)
		if err != nil {
			h.log.Errorf("comment-image NSFW batch check error: %v", err)
		} else if anyNsfw && !isAdult {
			if h.strikes != nil {
				if err := h.strikes.RecordDeniedNSFWBestEffort(context.Background(), uid); err != nil {
					h.log.Errorf("comment-image nsfw strike record: %v", err)
				}
			}
			return c.Status(422).JSON(fiber.Map{
				"error": "This image was detected as inappropriate and cannot be posted in comments",
				"nsfw":  true,
			})
		}
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext == "" {
		ext = ".jpg"
	}
	imageID := uuid.New().String()

	isVideoFolder := dateFolder != "" && uniqueID != "" &&
		reDateFolder.MatchString(dateFolder) && isSafeUniqueIDSegment(uniqueID)
	var ghPath string
	if isVideoFolder {
		// Policy guard: writing into a video's comments/ folder is only allowed
		// when that file exists and has comments enabled. The app proxy enforces
		// this, but a bearer-authenticated client can call the upload server
		// directly, so re-check here. Skipped when Supabase isn't configured (dev).
		if h.supabaseURL != "" && h.supabaseKey != "" {
			polCtx, polCancel := context.WithTimeout(context.Background(), 10*time.Second)
			own, oerr := supabase.FetchFileOwnership(polCtx, h.supabaseURL, h.supabaseKey, uniqueID)
			polCancel()
			if oerr != nil {
				h.log.Errorf("comment-image policy lookup: %v", oerr)
				return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "policy check failed"})
			}
			if !own.Found {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
			}
			if !own.CommentsEnabled {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "comments are disabled for this file"})
			}
		}
		ghPath = fmt.Sprintf("%s/%s/comments/%s%s", dateFolder, uniqueID, imageID, ext)
	} else {
		ghPath = fmt.Sprintf("comment-images/%s/%s%s", uid, imageID, ext)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Backend: video-folder images follow the parent file; standalone images
	// use the global default.
	backend := h.storageBackend
	if backend != "r2" {
		backend = "github"
	}
	if isVideoFolder && h.supabaseURL != "" && h.supabaseKey != "" {
		if fb, ferr := supabase.FetchFileStorageBackend(ctx, h.supabaseURL, h.supabaseKey, uniqueID); ferr == nil {
			backend = fb
		} else {
			h.log.Errorf("comment-image parent backend lookup: %v", ferr)
		}
	}

	repoForWebhook := h.ghRepo
	if backend == "r2" && h.r2 != nil {
		if err := h.r2.PutObject(ctx, ghPath, data, mime); err != nil {
			h.log.Errorf("comment-image R2 upload failed: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
		}
		repoForWebhook = ""
	} else {
		backend = "github"
		if h.ghCli == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "storage not configured"})
		}
		if err := ghlib.CreateOrUpdateFile(ctx, h.ghCli, h.ghOwner, h.ghRepo, ghPath, data, fmt.Sprintf("Comment image by %s", uid)); err != nil {
			h.log.Errorf("comment-image GitHub upload failed: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
		}
	}

	webhook.NotifyCommentImageStorage(ghPath, repoForWebhook, backend)
	go quota.Record(context.Background(), uid, "cmt_"+imageID, int64(len(data)))

	h.log.Infof("comment-image uploaded backend=%s user=%s path=%s", backend, uid, ghPath)

	// Storage repo/backend are recorded via NotifyCommentImageStorage webhook only
	// — never returned to the browser.
	return c.JSON(fiber.Map{
		"success": true,
		"image": fiber.Map{
			"url":  ghPath,
			"type": mime,
			"size": file.Size,
		},
	})
}
