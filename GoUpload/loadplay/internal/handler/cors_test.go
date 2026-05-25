package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/internal/guard"
)

func testGuard() guard.Config {
	return guard.NewConfig(
		"http://localhost:3000,https://memories.brozy.org",
		"http://localhost:3006,https://cdn.memories.brozy.org",
		false,
	)
}

func TestHasPlaybackContext(t *testing.T) {
	deps := ManifestDeps{Guard: testGuard()}

	cases := []struct {
		name       string
		origin     string
		referer    string
		appOrigin  string
		appReferer string
		secSite    string
		secMode    string
		want       bool
	}{
		{"app origin and referer", "http://localhost:3000", "http://localhost:3000/watch/abc", "", "", "", "", true},
		{"app headers only", "", "", "http://localhost:3000", "http://localhost:3000/watch/abc", "cross-site", "cors", true},
		{"hls follow-up", "http://localhost:3000", "http://localhost:3006/v/id/master.m3u8?t=x", "", "", "cross-site", "cors", true},
		{"missing referer", "http://localhost:3000", "", "", "", "cross-site", "cors", false},
		{"missing origin", "", "http://localhost:3000/watch/abc", "", "", "cross-site", "cors", false},
		{"standalone navigate", "", "", "", "", "none", "navigate", false},
		{"standalone loadplay referer only", "", "http://localhost:3006/v/id/master.m3u8?t=x", "", "", "none", "navigate", false},
		{"empty", "", "", "", "", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			app.Get("/", func(c *fiber.Ctx) error {
				setHeader(c, "Origin", tc.origin)
				setHeader(c, "Referer", tc.referer)
				setHeader(c, "X-App-Origin", tc.appOrigin)
				setHeader(c, "X-App-Referer", tc.appReferer)
				setHeader(c, "Sec-Fetch-Site", tc.secSite)
				setHeader(c, "Sec-Fetch-Mode", tc.secMode)
				got := hasPlaybackContext(c, deps)
				if got != tc.want {
					t.Fatalf("hasPlaybackContext() = %v, want %v", got, tc.want)
				}
				return nil
			})
			req := httptest.NewRequest("GET", "/", nil)
			if _, err := app.Test(req); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func setHeader(c *fiber.Ctx, key, val string) {
	if val != "" {
		c.Request().Header.Set(key, val)
	}
}
