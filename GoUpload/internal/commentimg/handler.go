package commentimg

import (
	"bytes"
	"context"
	"crypto/subtle"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	_ "golang.org/x/image/webp"

	"goupload/lib/ffmpeg"
	ghlib "goupload/lib/github"
	"goupload/lib/logger"
	"goupload/lib/nsfw"
	"goupload/lib/nsfwstrikes"
	"goupload/lib/quota"
	"goupload/lib/r2"
	"goupload/lib/security"
	"goupload/lib/supabase"
	"goupload/lib/usercap"
	"goupload/lib/webhook"

	"github.com/gofiber/fiber/v2"
	"github.com/google/go-github/v62/github"
	"github.com/google/uuid"
	"goupload/lib/imagegate"
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

// The stored name always ends in one of these, never in whatever the
// uploader's filename said.
var extByMIME = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

const maxDimension = 8192

type Handler struct {
	log           *logger.Logger
	nsfw          *nsfw.Detector
	strikes       *nsfwstrikes.Limiter
	caps          *usercap.Limiter
	ghCli         *github.Client
	ghOwner       string
	r2            *r2.Client
	supabaseURL   string
	supabaseKey   string
	webhookSecret string
}

type Config struct {
	// GitHub is only used to delete images stored there before the move to R2.
	GitHubClient  *github.Client
	GitHubOwner   string
	NSFWApiURL    string
	NSFWApiSecret string
	Strikes       *nsfwstrikes.Limiter
	// Required: every upload is refused without it.
	Caps *usercap.Limiter
	// Every new comment image goes to R2.
	R2          *r2.Client
	SupabaseURL string
	SupabaseKey string
	// Shared server-to-server secret for the internal delete route.
	WebhookSecret string
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, cfg Config) {
	h := &Handler{
		log:           log,
		nsfw:          nsfw.NewDetector(cfg.NSFWApiURL, cfg.NSFWApiSecret),
		strikes:       cfg.Strikes,
		caps:          cfg.Caps,
		ghCli:         cfg.GitHubClient,
		ghOwner:       cfg.GitHubOwner,
		r2:            cfg.R2,
		supabaseURL:   strings.TrimSpace(cfg.SupabaseURL),
		supabaseKey:   strings.TrimSpace(cfg.SupabaseKey),
		webhookSecret: strings.TrimSpace(cfg.WebhookSecret),
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

	// Only the database can say a file is adult. A client claim never relaxes
	// the check below, or anyone could post explicit images by sending
	// is_adult=true with a comment that has no verified file behind it.
	isAdult := false
	dateFolder := strings.TrimSpace(c.FormValue("date_folder"))
	uniqueID := strings.TrimSpace(c.FormValue("unique_id"))

	// Browser uploads may send file_id; resolve folder metadata when Supabase is wired.
	fileID := strings.TrimSpace(c.FormValue("file_id"))
	if fileID != "" {
		if h.supabaseURL == "" || h.supabaseKey == "" {
			if uniqueID == "" || dateFolder == "" {
				return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "policy check unavailable"})
			}
		} else {
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
	}

	// Verify the target folder BEFORE the strike / NSFW gates so the REAL
	// is_adult (from the DB, not the client's claim) drives them. Video-folder
	// comment images must reference a real file with comments enabled; fail
	// closed when we can't verify (Supabase not configured).
	isVideoFolder := dateFolder != "" && uniqueID != "" &&
		reDateFolder.MatchString(dateFolder) && isSafeUniqueIDSegment(uniqueID)
	if isVideoFolder {
		if h.supabaseURL == "" || h.supabaseKey == "" {
			h.log.Errorf("comment-image policy check unavailable: Supabase not configured")
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "policy check unavailable"})
		}
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
		// Real adult flag wins over the client's claim.
		isAdult = own.IsAdult
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

	if !allowedMIME[strings.ToLower(file.Header.Get("Content-Type"))] {
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
	// The Content-Type above is whatever the client said; GIFs go on to ffmpeg,
	// so the bytes themselves have to be an image, and they pick the type that
	// is stored and how it is checked.
	mime := http.DetectContentType(data)
	if security.MediaKind(data) != "image" || !allowedMIME[mime] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file type"})
	}
	// Dimensions come from the header alone. A tiny file claiming a huge
	// canvas would otherwise make ffmpeg allocate gigabytes.
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > maxDimension || cfg.Height > maxDimension {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file type"})
	}

	if !h.caps.Allow(c, uid, "too_many_requests", usercap.CommentImage...) {
		return nil
	}

	qctx, qcancel := context.WithTimeout(c.UserContext(), 6*time.Second)
	qres, qerr := quota.Check(qctx, uid, int64(len(data)))
	qcancel()
	if qerr != nil {
		h.log.Errorf("comment-image quota check unavailable user=%s: %v", uid, qerr)
		c.Set("Retry-After", "30")
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "busy"})
	}
	if !qres.OK {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"error": "monthly_limit_exceeded"})
	}

	var toScan [][]byte
	if mime == "image/gif" {
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

	// An image nobody could check is not posted.
	moderationDown := func() error {
		c.Set("Retry-After", "30")
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Image check is unavailable right now. Try again in a moment."})
	}
	// Adult posts may take adult images in their comments, but nothing may show gore.
	if len(toScan) == 1 {
		result, err := h.nsfw.Detect(toScan[0])
		if err != nil {
			h.log.Errorf("comment-image NSFW check error: %v", err)
			return moderationDown()
		} else if result.IsNSFW && (!isAdult || result.IsHarmful()) {
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
		anyNsfw, merged, err := h.nsfw.DetectBatch(toScan)
		if err != nil {
			h.log.Errorf("comment-image NSFW batch check error: %v", err)
			return moderationDown()
		} else if anyNsfw && (!isAdult || merged.IsHarmful()) {
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

	ext := extByMIME[mime]
	imageID := uuid.New().String()

	// isVideoFolder was resolved + verified above, before the NSFW gate.
	var ghPath string
	if isVideoFolder {
		ghPath = fmt.Sprintf("%s/%s/comments/%s%s", dateFolder, uniqueID, imageID, ext)
	} else {
		ghPath = fmt.Sprintf("comment-images/%s/%s%s", uid, imageID, ext)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Always R2, even under a video still stored on GitHub. The webhook records
	// the backend per image so the loaders know where to look.
	if h.r2 == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "storage not configured"})
	}
	if err := h.r2.PutObject(ctx, ghPath, data, mime); err != nil {
		h.log.Errorf("comment-image R2 upload failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "upload failed"})
	}

	webhook.NotifyCommentImageStorage(ghPath, "", "r2")
	go quota.Record(context.Background(), uid, "cmt_"+imageID, int64(len(data)))

	h.log.Infof("comment-image uploaded user=%s path=%s", uid, ghPath)

	// Storage repo/backend are recorded via NotifyCommentImageStorage webhook only
	// — never returned to the browser.
	return c.JSON(fiber.Map{
		"success": true,
		"image": fiber.Map{
			"url":  ghPath,
			"type": mime,
			"size": len(data),
		},
	})
}
