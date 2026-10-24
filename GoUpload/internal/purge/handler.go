// Package purge exposes POST /internal/purge: a server-to-server-only
// endpoint the app calls when an owner permanently deletes a file. It wipes
// the file's entire storage directory ({dd_mm_yyyy}/{upload_id}/) on the
// backend that holds it  R2 or GitHub  so nothing survives the delete.
//
// Auth: X-Webhook-Secret must equal UPLOAD_WEBHOOK_SECRET (constant-time
// compare), the same server-side secret all app↔worker webhooks share. The
// secret never ships to a browser. Ownership is enforced by the app BEFORE
// it calls here; this endpoint additionally hard-validates the prefix shape
// so even a confused caller can only ever delete one upload directory.
package purge

import (
	"context"
	"crypto/subtle"
	"regexp"
	"strings"
	"time"

	ghlib "goupload/lib/github"
	"goupload/lib/logger"
	"goupload/lib/queue"
	"goupload/lib/r2"

	gh "github.com/google/go-github/v62/github"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

type Config struct {
	GitHubClient *gh.Client
	GitHubOwner  string
	GitHubBranch string
	R2           *r2.Client
	Log          *logger.Logger
	// Queue carries the cancel flag the worker checks for /internal/cancel.
	Queue *queue.Client
}

var uploadIDRe = regexp.MustCompile(`^[a-f0-9]{32}$`)

type cancelBody struct {
	UploadID string `json:"upload_id"`
	// Prefix is the upload's storage directory when the app knows it, so what
	// is already stored goes now even if no worker is left to notice the flag.
	Prefix string `json:"prefix"`
}

// prefixRe pins the only deletable shape: one upload directory. No dots, no
// slash→parent tricks, no bucket-wide prefixes.
var prefixRe = regexp.MustCompile(`^\d{2}_\d{2}_\d{4}/[a-f0-9]{32}/$`)

var repoRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)

const (
	maxPurgeKeys      = 20000
	deleteConcurrency = 8
)

type purgeBody struct {
	Backend string `json:"backend"`
	Prefix  string `json:"prefix"`
	Repo    string `json:"repo"`
}

func RegisterRoutes(app *fiber.App, webhookSecret string, cfg Config) {
	// Deletes are rare, human-paced events; anything faster is a bug or abuse.
	app.Use("/internal/purge", limiter.New(limiter.Config{
		Max:        30,
		Expiration: time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			c.Set("Retry-After", "60")
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "rate_limited"})
		},
	}))

	app.Post("/internal/purge", func(c *fiber.Ctx) error {
		if webhookSecret == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}
		provided := c.Get("X-Webhook-Secret")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(webhookSecret)) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		var body purgeBody
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
		}
		prefix := strings.TrimSpace(body.Prefix)
		if !prefixRe.MatchString(prefix) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		// A deleted upload may still have auto captions waiting; this drops them.
		if cfg.Queue != nil {
			uploadID := strings.TrimSuffix(prefix[strings.Index(prefix, "/")+1:], "/")
			if err := cfg.Queue.RequestCancel(ctx, uploadID); err != nil && cfg.Log != nil {
				cfg.Log.Errorf("purge cancel flag upload=%s err=%s", uploadID, err.Error())
			}
		}

		switch body.Backend {
		case "r2":
			if cfg.R2 == nil {
				return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
			}
			deleted, err := purgeR2(ctx, cfg.R2, prefix)
			if err != nil {
				if cfg.Log != nil {
					cfg.Log.Errorf("purge r2 prefix=%s err=%s", prefix, err.Error())
				}
				return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "purge_failed"})
			}
			if cfg.Log != nil {
				cfg.Log.Infof("purge r2 prefix=%s deleted=%d", prefix, deleted)
			}
			return c.JSON(fiber.Map{"ok": true, "deleted": deleted})

		case "github":
			if cfg.GitHubClient == nil || cfg.GitHubOwner == "" {
				return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
			}
			repo := strings.TrimSpace(body.Repo)
			if !repoRe.MatchString(repo) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
			}
			deleted, err := ghlib.DeleteFolder(ctx, cfg.GitHubClient, cfg.GitHubOwner, repo, cfg.GitHubBranch, prefix, "Remove deleted upload")
			// Never log the repo (or anything traceable to it)  storage
			// location stays internal, same rule as client responses. Library
			// errors can embed request URLs, so redact owner/repo from them.
			if err != nil {
				if cfg.Log != nil {
					msg := err.Error()
					msg = strings.ReplaceAll(msg, cfg.GitHubOwner+"/"+repo, "archive")
					msg = strings.ReplaceAll(msg, repo, "archive")
					if cfg.GitHubOwner != "" {
						msg = strings.ReplaceAll(msg, cfg.GitHubOwner, "archive")
					}
					cfg.Log.Errorf("purge archive prefix=%s err=%s", prefix, msg)
				}
				return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "purge_failed"})
			}
			// Thumbnails, captions and comment images added after the move to R2
			// live there even though the video itself is on GitHub.
			if cfg.R2 != nil {
				extra, rerr := purgeR2(ctx, cfg.R2, prefix)
				if rerr != nil {
					if cfg.Log != nil {
						cfg.Log.Errorf("purge r2 side files prefix=%s err=%s", prefix, rerr.Error())
					}
					return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "purge_failed"})
				}
				deleted += extra
			}
			if cfg.Log != nil {
				cfg.Log.Infof("purge archive prefix=%s deleted=%d", prefix, deleted)
			}
			return c.JSON(fiber.Map{"ok": true, "deleted": deleted})
		}

		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
	})

	app.Use("/internal/cancel", limiter.New(limiter.Config{
		Max:        30,
		Expiration: time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			c.Set("Retry-After", "60")
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "rate_limited"})
		},
	}))

	// POST /internal/cancel: the owner stopped an upload while it processed.
	// The flag makes the worker drop the job at its next step and delete what
	// it stored; anything already stored under a known prefix goes right now.
	// Ownership is checked by the app before it calls here, as with purge.
	app.Post("/internal/cancel", func(c *fiber.Ctx) error {
		if webhookSecret == "" || cfg.Queue == nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}
		provided := c.Get("X-Webhook-Secret")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(webhookSecret)) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		var body cancelBody
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
		}
		uploadID := strings.TrimSpace(body.UploadID)
		prefix := strings.TrimSpace(body.Prefix)
		// The prefix may only ever name this upload's own directory.
		if !uploadIDRe.MatchString(uploadID) || (prefix != "" && (!prefixRe.MatchString(prefix) || !strings.HasSuffix(prefix, "/"+uploadID+"/"))) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		// Fail closed: without the flag a running worker would keep publishing.
		if err := cfg.Queue.RequestCancel(ctx, uploadID); err != nil {
			if cfg.Log != nil {
				cfg.Log.Errorf("cancel flag upload=%s err=%s", uploadID, err.Error())
			}
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}

		deleted := 0
		if prefix != "" && cfg.R2 != nil {
			n, err := purgeR2(ctx, cfg.R2, prefix)
			if err != nil {
				if cfg.Log != nil {
					cfg.Log.Errorf("cancel purge prefix=%s err=%s", prefix, err.Error())
				}
				return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "purge_failed"})
			}
			deleted = n
		}
		if cfg.Log != nil {
			cfg.Log.Infof("upload canceled upload=%s deleted_now=%d", uploadID, deleted)
		}
		return c.JSON(fiber.Map{"ok": true})
	})
}

// purgeR2 deletes every key under prefix.
func purgeR2(ctx context.Context, client *r2.Client, prefix string) (int, error) {
	return client.DeletePrefix(ctx, prefix, maxPurgeKeys, deleteConcurrency)
}
