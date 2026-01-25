package middleware

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

	"goupload/lib/env"
	"github.com/gofiber/fiber/v2"
)

const LocalsUserID = "userID"

type uploadServerCheckResponse struct {
	UserID string `json:"userId"`
}

// AuthUpload verifies the user via the app's /api/upload-server-check.
// Client must send: Authorization: Bearer <c_user>
// On success sets c.Locals(LocalsUserID, userId). On failure returns a generic error only (no internal details).
func AuthUpload() fiber.Handler {
	appBaseURL := env.Get("APP_BASE_URL", "http://127.0.0.1:5173")
	appBaseURL = strings.TrimSuffix(appBaseURL, "/")
	checkURL := appBaseURL + "/api/upload-server-check"

	return func(c *fiber.Ctx) error {
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

		req, err := http.NewRequestWithContext(c.Context(), http.MethodGet, checkURL, nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "auth_request_failed"})
		}
		req.Header.Set("Authorization", "Bearer "+cUser)

		client := &http.Client{}
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
		if payload.UserID == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		c.Locals(LocalsUserID, payload.UserID)
		return c.Next()
	}
}
