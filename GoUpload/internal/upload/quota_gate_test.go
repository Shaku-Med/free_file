package upload

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// appWithRoom stands in for the app's quota check: a user has `room` bytes left.
func appWithRoom(t *testing.T, room int64, status int) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		var body struct {
			Predicted int64 `json:"predicted_bytes"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": body.Predicted <= room, "used": 1000 - room, "limit": 1000, "remaining": room,
		})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("APP_BASE_URL", srv.URL)
	t.Setenv("UPLOAD_WEBHOOK_SECRET", "s3cret")
}

func startRequest(t *testing.T, m *Manager, size int64) (int, map[string]any) {
	t.Helper()
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("userID", "alice")
		return c.Next()
	})
	h := &Handler{manager: m}
	app.Post("/start", h.startUpload)
	chunks := (size + testChunk - 1) / testChunk
	body := `{"file_name":"clip.mp4","file_size":` + strconv.FormatInt(size, 10) + `,"total_chunks":` + strconv.FormatInt(chunks, 10) + `}`
	req := httptest.NewRequest(http.MethodPost, "/start", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := app.Test(req, -1)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func TestStartTurnsAwayAFileBiggerThanWhatIsLeft(t *testing.T) {
	appWithRoom(t, 100, http.StatusOK)
	m := testManagerWith(t, ManagerConfig{MaxDiskBytes: 1 << 30, MaxConcurrent: 4})
	status, body := startRequest(t, m, 101)
	if status != fiber.StatusRequestEntityTooLarge || body["error"] != "monthly_limit_exceeded" || body["remaining"] != float64(100) {
		t.Fatalf("got %d %v", status, body)
	}
	if m.activeCount() != 0 {
		t.Fatal("a refused file must not open an upload")
	}
}

func TestStartLetsInAFileThatUsesEverythingLeft(t *testing.T) {
	appWithRoom(t, 100, http.StatusOK)
	m := testManagerWith(t, ManagerConfig{MaxDiskBytes: 1 << 30, MaxConcurrent: 4})
	// Past the quota gate it reaches the per account caps, which are not set
	// in this test and refuse with a busy answer.
	status, body := startRequest(t, m, 100)
	if status != fiber.StatusServiceUnavailable || body["error"] != "server_busy" {
		t.Fatalf("got %d %v", status, body)
	}
}

func TestStartWaitsWhenTheQuotaCannotBeChecked(t *testing.T) {
	appWithRoom(t, 0, http.StatusInternalServerError)
	m := testManagerWith(t, ManagerConfig{MaxDiskBytes: 1 << 30, MaxConcurrent: 4})
	status, body := startRequest(t, m, 10)
	if status != fiber.StatusServiceUnavailable || body["error"] != "quota_unavailable" {
		t.Fatalf("got %d %v", status, body)
	}
}
