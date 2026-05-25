package handler

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestProductionLiveIs404WithLedger(t *testing.T) {
	app := fiber.New()
	app.Get("/live", ProductionLive)

	req := httptest.NewRequest("GET", "/live", nil)
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	if res.StatusCode != 404 {
		t.Fatalf("status = %d, want 404", res.StatusCode)
	}
	body, _ := io.ReadAll(res.Body)
	var parsed struct {
		Error    string               `json:"error"`
		Message  string               `json:"message"`
		Releases []ProductionRelease  `json:"releases"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("json: %v", err)
	}
	if parsed.Error != "Something's wrong." {
		t.Fatalf("error = %q", parsed.Error)
	}
	if parsed.Message == "" {
		t.Fatal("expected non-empty message")
	}
	if len(parsed.Releases) != len(productionLiveLedger) {
		t.Fatalf("releases len = %d, want %d", len(parsed.Releases), len(productionLiveLedger))
	}
	if cc := res.Header.Get("Cache-Control"); cc == "" || !strings.Contains(cc, "no-store") {
		t.Fatalf("Cache-Control = %q, want no-store", cc)
	}
}
