package handler

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"goupload/lib/logger"
	"goupload/lib/r2"
	"goupload/loadplay/lib/storage"
)

func TestRedirectToR2SignsOneShortLink(t *testing.T) {
	client, err := r2.New(r2.Config{AccountID: "acct", AccessKeyID: "AKID", SecretAccessKey: "secret", Bucket: "media"})
	if err != nil {
		t.Fatal(err)
	}
	deps := ManifestDeps{Log: logger.New(16), R2Redirect: time.Minute}
	st := storage.Config{Backend: "r2", R2: client}

	app := fiber.New()
	app.Get("/bad", func(c *fiber.Ctx) error {
		return redirectToR2(c, deps, st, "..")
	})
	app.Get("/*", func(c *fiber.Ctx) error {
		return redirectToR2(c, deps, st, c.Params("*"))
	})

	res, err := app.Test(httptest.NewRequest("GET", "/01_02_2026/abc/720p/0001.ts", nil))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != fiber.StatusFound {
		t.Fatalf("status = %d, want 302", res.StatusCode)
	}
	loc, err := url.Parse(res.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if loc.Host != "acct.r2.cloudflarestorage.com" || !strings.HasSuffix(loc.Path, "/01_02_2026/abc/720p/0001.ts") {
		t.Errorf("location = %s", loc)
	}
	if got := loc.Query().Get("X-Amz-Expires"); got != "60" {
		t.Errorf("X-Amz-Expires = %q, want 60", got)
	}
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("Cache-Control = %q, the redirect must not be cached", cc)
	}

	res, err = app.Test(httptest.NewRequest("GET", "/bad", nil))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode == fiber.StatusFound {
		t.Errorf("an unsafe path was signed")
	}
}
