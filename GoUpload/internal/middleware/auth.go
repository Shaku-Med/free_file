package middleware

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"goupload/lib/env"
)

// userIDPattern rejects shapes that could inject into filesystem paths downstream.
var userIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

const authCheckTimeout = 12 * time.Second

const LocalsUserID = "userID"

// LocalsUsername is the account username from the app (for safe storage paths).
const LocalsUsername = "username"

// maxTokenLen sits far above any real upload bearer.
const maxTokenLen = 16 << 10

func plausibleToken(s string) bool {
	if len(s) > maxTokenLen {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < 0x21 || s[i] > 0x7e {
			return false
		}
	}
	return true
}

type uploadServerCheckResponse struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
}

// AuthUpload verifies the client's short-lived upload_token via /api/upload-server-check (with X-Webhook-Secret).
func AuthUpload() fiber.Handler {
	appBaseURL := env.Get("APP_BASE_URL", "http://localhost:3000")
	appBaseURL = strings.TrimSuffix(appBaseURL, "/")
	checkURL := appBaseURL + "/api/upload-server-check"

	return func(c *fiber.Ctx) error {
		// Allow CORS preflight requests through  browsers send OPTIONS without auth headers
		if c.Method() == fiber.MethodOptions {
			return c.Next()
		}

		auth := c.Get("Authorization")
		if auth == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_authorization"})
		}
		const prefix = "Bearer "
		if !strings.HasPrefix(auth, prefix) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid_authorization"})
		}
		cUser := strings.TrimSpace(auth[len(prefix):])
		if cUser == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing_c_user"})
		}
		// Refused here rather than forwarded: every request costs the app a
		// check, so junk never leaves this box.
		if !plausibleToken(cUser) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		req, err := http.NewRequestWithContext(c.Context(), http.MethodGet, checkURL, nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "auth_request_failed"})
		}
		req.Header.Set("Authorization", "Bearer "+cUser)
		// Shared secret so only GoUpload can hit /api/upload-server-check
		// (browser clients must never call that endpoint).
		if secret := env.Get("UPLOAD_WEBHOOK_SECRET", ""); secret != "" {
			req.Header.Set("X-Webhook-Secret", secret)
		}

		client := &http.Client{Timeout: authCheckTimeout}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[AuthUpload] auth_check_failed: %v", err)
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "auth_check_failed"})
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "auth_parse_failed"})
		}

		var payload uploadServerCheckResponse
		if err := json.Unmarshal(body, &payload); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}
		if payload.UserID == "" || !userIDPattern.MatchString(payload.UserID) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		c.Locals(LocalsUserID, payload.UserID)
		if strings.TrimSpace(payload.Username) != "" {
			c.Locals(LocalsUsername, strings.TrimSpace(payload.Username))
		}
		return c.Next()
	}
}
