// Package acoustidhook receives AcoustID match results from the sidecar,
// hosts cover art next to the upload's thumbnails, and forwards the result
// to the app with a storage path (not an external Cover Art Archive URL).
package acoustidhook

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	ghlib "goupload/lib/github"
	"goupload/lib/logger"
	"goupload/lib/r2"
	"goupload/lib/webhook"

	gh "github.com/google/go-github/v62/github"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

const coverFileName = "acoustid_cover.jpg"

type Config struct {
	ThumbnailDir   string
	GitHubClient   *gh.Client
	GitHubOwner    string
	GitHubRepo     string
	GitHubBranch   string
	R2             *r2.Client
	StorageBackend string
	WebhookSecret  string
	Log            *logger.Logger
}

var (
	uploadIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	userIDRe   = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	prefixRe   = regexp.MustCompile(`^\d{2}_\d{2}_\d{4}/[A-Za-z0-9_-]{1,128}/$`)
)

func RegisterRoutes(app *fiber.App, cfg Config) {
	app.Use("/internal/acoustid-result", limiter.New(limiter.Config{
		Max:        60,
		Expiration: time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			c.Set("Retry-After", "60")
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "rate_limited"})
		},
	}))

	app.Post("/internal/acoustid-result", func(c *fiber.Ctx) error {
		if cfg.WebhookSecret == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}
		provided := c.Get("X-Webhook-Secret")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(cfg.WebhookSecret)) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		uploadID := strings.TrimSpace(c.FormValue("upload_id"))
		userID := strings.TrimSpace(c.FormValue("user_id"))
		jobID := strings.TrimSpace(c.FormValue("job_id"))
		storagePrefix := strings.TrimSpace(c.FormValue("storage_prefix"))
		matched := strings.TrimSpace(c.FormValue("matched")) == "true"
		matchJSON := strings.TrimSpace(c.FormValue("match"))

		if !uploadIDRe.MatchString(uploadID) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid upload_id"})
		}

		payload := map[string]interface{}{
			"job_id":    jobID,
			"upload_id": uploadID,
			"unique_id": uploadID,
			"matched":   matched,
		}
		if errMsg := strings.TrimSpace(c.FormValue("error")); errMsg != "" {
			payload["error"] = errMsg
		}
		if v := strings.TrimSpace(c.FormValue("clip_start")); v != "" {
			var f float64
			if _, err := fmt.Sscanf(v, "%f", &f); err == nil {
				payload["clip_start"] = f
			}
		}
		if v := strings.TrimSpace(c.FormValue("clip_end")); v != "" {
			var f float64
			if _, err := fmt.Sscanf(v, "%f", &f); err == nil {
				payload["clip_end"] = f
			}
		}
		if v := strings.TrimSpace(c.FormValue("match_count")); v != "" {
			var n int
			if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
				payload["match_count"] = n
			}
		}
		if v := strings.TrimSpace(c.FormValue("min_score")); v != "" {
			var f float64
			if _, err := fmt.Sscanf(v, "%f", &f); err == nil {
				payload["min_score"] = f
			}
		}

		var match map[string]interface{}
		if matched && matchJSON != "" {
			if err := json.Unmarshal([]byte(matchJSON), &match); err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid match json"})
			}
		}

		coverPath := ""
		if matched && match != nil {
			// Never keep an external CAA URL in what we send to the app.
			delete(match, "cover_art")

			fh, err := c.FormFile("cover")
			if err == nil && fh != nil && fh.Size > 0 && userIDRe.MatchString(userID) && prefixRe.MatchString(storagePrefix) {
				if path, uerr := cfg.uploadCover(c.Context(), userID, uploadID, storagePrefix, fh); uerr != nil {
					if cfg.Log != nil {
						cfg.Log.Errorf("acoustid cover upload failed upload=%s err=%s", uploadID, uerr.Error())
					}
				} else {
					coverPath = path
					match["cover_art"] = path
					if cfg.Log != nil {
						cfg.Log.Infof("acoustid cover hosted upload=%s path=%s", uploadID, path)
					}
				}
			}
			payload["match"] = match
		}

		webhook.NotifyAcoustidResult(payload)
		return c.JSON(fiber.Map{"ok": true, "cover_art": coverPath})
	})
}

func (cfg Config) uploadCover(ctx context.Context, userID, uploadID, storagePrefix string, fh *multipart.FileHeader) (string, error) {
	thumbDir := filepath.Join(cfg.ThumbnailDir, userID, uploadID)
	if err := os.MkdirAll(thumbDir, 0o700); err != nil {
		return "", err
	}
	localPath := filepath.Join(thumbDir, coverFileName)

	src, err := fh.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()

	const maxCover = 8 << 20
	data, err := io.ReadAll(io.LimitReader(src, maxCover+1))
	if err != nil {
		return "", err
	}
	if len(data) == 0 || len(data) > maxCover {
		return "", fmt.Errorf("invalid cover size %d", len(data))
	}
	if err := os.WriteFile(localPath, data, 0o600); err != nil {
		return "", err
	}

	repoPath := storagePrefix + coverFileName
	useR2 := strings.ToLower(cfg.StorageBackend) == "r2" && cfg.R2 != nil
	if useR2 {
		if err := cfg.R2.PutObject(ctx, repoPath, data, "image/jpeg"); err != nil {
			return "", err
		}
	} else {
		if cfg.GitHubClient == nil || cfg.GitHubOwner == "" || cfg.GitHubRepo == "" {
			return "", fmt.Errorf("no storage backend for cover")
		}
		branch := cfg.GitHubBranch
		if branch == "" {
			branch = "main"
		}
		files := []ghlib.BatchFile{{RepoPath: repoPath, LocalPath: localPath}}
		if err := ghlib.BatchCommit(ctx, cfg.GitHubClient, cfg.GitHubOwner, cfg.GitHubRepo, branch, "AcoustID cover "+uploadID, files, 1, nil); err != nil {
			return "", err
		}
	}
	return repoPath, nil
}
