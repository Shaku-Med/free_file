package handler

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/internal/guard"
)

func testGuard() guard.Config {
	return guard.NewConfig(
		"http://localhost:3000,http://127.0.0.1:3000,https://memories.brozy.org,https://uploads.memories.brozy.org",
		"http://localhost:3006,https://cdn.memories.brozy.org",
		false,
	)
}

func setHLSSecFetch(c *fiber.Ctx) {
	c.Request().Header.Set("Sec-Fetch-Mode", "cors")
	c.Request().Header.Set("Sec-Fetch-Site", "same-site")
	c.Request().Header.Set("Sec-Fetch-Dest", "empty")
}

func setAppAttestation(c *fiber.Ctx, origin, referer string) {
	c.Request().Header.Set("X-App-Origin", origin)
	c.Request().Header.Set("X-App-Referer", referer)
}

func TestHasPlaybackContext(t *testing.T) {
	deps := ManifestDeps{Guard: testGuard()}

	cases := []struct {
		name    string
		origin  string
		referer string
		want    bool
	}{
		{"app origin and referer", "http://localhost:3000", "http://localhost:3000/watch/abc", true},
		{"prod app", "https://memories.brozy.org", "https://memories.brozy.org/v/abc", true},
		{"missing referer", "http://localhost:3000", "", false},
		{"missing origin", "", "http://localhost:3000/watch/abc", false},
		{"cdn referer not allowed", "http://localhost:3000", "http://localhost:3006/v/id/master.m3u8?t=x", false},
		{"cdn origin not allowed", "http://localhost:3006", "http://localhost:3000/watch", false},
		{"lookalike host", "https://memories.brozy.org.evil.com", "https://memories.brozy.org.evil.com/x", false},
		{"evil with app in query", "https://evil.com", "https://evil.com/?ref=https://memories.brozy.org", false},
		{"empty", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			app.Get("/", func(c *fiber.Ctx) error {
				if tc.origin != "" {
					c.Request().Header.Set("Origin", tc.origin)
				}
				if tc.referer != "" {
					c.Request().Header.Set("Referer", tc.referer)
				}
				if tc.want {
					setHLSSecFetch(c)
					setAppAttestation(c, tc.origin, tc.referer)
				}
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

func TestStandaloneNavigateRejected(t *testing.T) {
	deps := ManifestDeps{Guard: testGuard()}
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		c.Request().Header.Set("Origin", "http://localhost:3000")
		c.Request().Header.Set("Referer", "http://localhost:3000/watch/abc")
		c.Request().Header.Set("Sec-Fetch-Mode", "navigate")
		c.Request().Header.Set("Sec-Fetch-Dest", "document")
		if hasPlaybackContext(c, deps) {
			t.Fatal("expected standalone navigate to be rejected")
		}
		return nil
	})
	req := httptest.NewRequest("GET", "/", nil)
	if _, err := app.Test(req); err != nil {
		t.Fatal(err)
	}
}

func TestHLSFetchAllowed(t *testing.T) {
	deps := ManifestDeps{Guard: testGuard()}
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		c.Request().Header.Set("Origin", "http://localhost:3000")
		c.Request().Header.Set("Referer", "http://localhost:3000/watch/abc")
		setHLSSecFetch(c)
		setAppAttestation(c, "http://localhost:3000", "http://localhost:3000/watch/abc")
		c.Request().Header.Set("Accept", "*/*")
		if !hasPlaybackContext(c, deps) {
			t.Fatal("expected in-page cors fetch to pass")
		}
		return nil
	})
	req := httptest.NewRequest("GET", "/", nil)
	if _, err := app.Test(req); err != nil {
		t.Fatal(err)
	}
}

func TestStandaloneSiteNoneRejected(t *testing.T) {
	deps := ManifestDeps{Guard: testGuard()}
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		c.Request().Header.Set("Origin", "http://localhost:3000")
		c.Request().Header.Set("Referer", "http://localhost:3000/watch/abc")
		c.Request().Header.Set("Sec-Fetch-Mode", "cors")
		c.Request().Header.Set("Sec-Fetch-Site", "none")
		c.Request().Header.Set("Sec-Fetch-Dest", "empty")
		if hasPlaybackContext(c, deps) {
			t.Fatal("expected site=none to be rejected")
		}
		return nil
	})
	req := httptest.NewRequest("GET", "/", nil)
	if _, err := app.Test(req); err != nil {
		t.Fatal(err)
	}
}

func TestStandardOriginRefererAccepted(t *testing.T) {
	// X-App-Origin / X-App-Referer are no longer required — the standard
	// Origin + Referer pair (set by browsers, not JS) is sufficient.
	// Curl/scripts can't forge these because browsers won't send Origin
	// on top-level navigation and won't send Referer on typed URLs.
	deps := ManifestDeps{Guard: testGuard()}
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		c.Request().Header.Set("Origin", "http://localhost:3000")
		c.Request().Header.Set("Referer", "http://localhost:3000/watch/abc")
		setHLSSecFetch(c)
		if !hasPlaybackContext(c, deps) {
			t.Fatal("standard Origin + Referer + Sec-Fetch should pass")
		}
		return nil
	})
	req := httptest.NewRequest("GET", "/", nil)
	if _, err := app.Test(req); err != nil {
		t.Fatal(err)
	}
}

func TestBareCurlLikeRejected(t *testing.T) {
	deps := ManifestDeps{Guard: testGuard()}
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		c.Request().Header.Set("User-Agent", "curl/8.5.0")
		c.Request().Header.Set("Accept", "*/*")
		if hasPlaybackContext(c, deps) {
			t.Fatal("expected bare curl-like request to be rejected")
		}
		return nil
	})
	req := httptest.NewRequest("GET", "/", nil)
	if _, err := app.Test(req); err != nil {
		t.Fatal(err)
	}
}

func TestStandaloneNoCorsRejected(t *testing.T) {
	deps := ManifestDeps{Guard: testGuard()}
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		c.Request().Header.Set("Origin", "http://localhost:3000")
		c.Request().Header.Set("Referer", "http://localhost:3000/watch/abc")
		c.Request().Header.Set("Sec-Fetch-Mode", "no-cors")
		c.Request().Header.Set("Sec-Fetch-Site", "same-site")
		c.Request().Header.Set("Sec-Fetch-Dest", "empty")
		if hasPlaybackContext(c, deps) {
			t.Fatal("expected no-cors to be rejected")
		}
		return nil
	})
	req := httptest.NewRequest("GET", "/", nil)
	if _, err := app.Test(req); err != nil {
		t.Fatal(err)
	}
}

func TestStandaloneHtmlAcceptRejected(t *testing.T) {
	deps := ManifestDeps{Guard: testGuard()}
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		c.Request().Header.Set("Origin", "http://localhost:3000")
		c.Request().Header.Set("Referer", "http://localhost:3000/watch/abc")
		c.Request().Header.Set("Sec-Fetch-Mode", "cors")
		c.Request().Header.Set("Sec-Fetch-Site", "same-site")
		c.Request().Header.Set("Accept", "text/html,application/xhtml+xml")
		if hasPlaybackContext(c, deps) {
			t.Fatal("expected html accept to be rejected")
		}
		return nil
	})
	req := httptest.NewRequest("GET", "/", nil)
	if _, err := app.Test(req); err != nil {
		t.Fatal(err)
	}
}

func TestGuardBlocksLookalikeHosts(t *testing.T) {
	g := testGuard()
	cases := []struct {
		raw  string
		want bool
	}{
		{"https://memories.brozy.org/watch", true},
		{"https://memories.brozy.org.evil.com/watch", false},
		{"https://evil.com/memories.brozy.org", false},
		{"https://evil.com/?url=https://memories.brozy.org", false},
		{"http://localhost:3000/", true},
	}
	for _, tc := range cases {
		if got := g.AllowsOrigin(tc.raw); got != tc.want {
			t.Fatalf("AllowsOrigin(%q) = %v, want %v", tc.raw, got, tc.want)
		}
	}
}
