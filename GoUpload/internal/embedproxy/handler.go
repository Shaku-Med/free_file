// Package embedproxy exposes POST /internal/embed: a server-to-server-only
// bridge so the app can turn search queries into vectors without ever
// reaching the EmbedAPI sidecar (which stays on the private docker network).
//
// Auth: X-Webhook-Secret must equal UPLOAD_WEBHOOK_SECRET (constant-time
// compare) - the same server-side secret the app/worker webhooks already
// share. The secret never ships to a browser, so the endpoint is unusable
// from the internet even though the GoUpload port itself is reachable.
package embedproxy

import (
	"crypto/subtle"
	"strings"
	"time"

	"goupload/lib/embed"
	"goupload/lib/logger"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

const (
	maxTexts     = 16
	maxTextChars = 2000
)

type embedBody struct {
	Texts []string `json:"texts"`
	Kind  string   `json:"kind"`
}

func RegisterRoutes(app *fiber.App, log *logger.Logger, client *embed.Client, webhookSecret string) {
	// Modest budget: every call is one short query string from the app's
	// search route (which caches embeddings). Keyed by IP - the only valid
	// caller is the app server, so this mostly throttles scanners.
	app.Use("/internal/embed", limiter.New(limiter.Config{
		Max:        240,
		Expiration: time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return "ip:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			c.Set("Retry-After", "60")
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"error": "rate_limited"})
		},
	}))

	app.Post("/internal/embed", func(c *fiber.Ctx) error {
		if webhookSecret == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}
		provided := c.Get("X-Webhook-Secret")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(webhookSecret)) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}
		if !client.Enabled() {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "unavailable"})
		}

		var body embedBody
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
		}
		if len(body.Texts) == 0 || len(body.Texts) > maxTexts {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
		}
		texts := make([]string, 0, len(body.Texts))
		for _, t := range body.Texts {
			t = strings.TrimSpace(t)
			if t == "" {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
			}
			// Truncate long text instead of rejecting, and count RUNES like the
			// sidecar does - len() counts bytes, so a 2000-char Chinese
			// description (up to 4 bytes per char) was 400ing its whole batch.
			if runes := []rune(t); len(runes) > maxTextChars {
				t = string(runes[:maxTextChars])
			}
			texts = append(texts, t)
		}

		vectors, err := client.Embed(c.Context(), texts, body.Kind)
		if err != nil {
			if log != nil {
				log.Errorf("embedproxy: %s", err.Error())
			}
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "unavailable"})
		}

		return c.JSON(fiber.Map{"dim": embed.Dim, "vectors": vectors})
	})
}
