package stems

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func audioFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "stems.flac")
	if err := os.WriteFile(path, []byte("fLaC fake audio"), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSeparateSendsTheSecretAndFile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Internal-Secret") != "s3cret" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Content-Type") != "audio/flac" || r.ContentLength != int64(len("fLaC fake audio")) {
			http.Error(w, "not flac", http.StatusUnsupportedMediaType)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != "fLaC fake audio" {
			http.Error(w, "wrong file", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"fps":43.07,"duration":12.5,"frames":2,"series":{"kick":[0,1]}}`))
	}))
	defer srv.Close()

	got, err := NewClient(srv.URL, "s3cret").Separate(context.Background(), audioFile(t))
	if err != nil {
		t.Fatal(err)
	}
	if got.FPS != 43.07 || got.Duration != 12.5 || len(got.Series["kick"]) != 2 {
		t.Fatalf("bad answer %+v", got)
	}
}

func TestSeparateErrors(t *testing.T) {
	status := http.StatusServiceUnavailable
	body := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "s3cret")
	path := audioFile(t)

	if _, err := c.Separate(context.Background(), path); !errors.Is(err, ErrBusy) {
		t.Fatalf("503: got %v, want ErrBusy", err)
	}

	status, body = http.StatusUnprocessableEntity, strings.Repeat("x", 2000)
	_, err := c.Separate(context.Background(), path)
	if err == nil || len(err.Error()) > 400 {
		t.Fatalf("422: error missing or not cut short: %d bytes", len(err.Error()))
	}

	status, body = http.StatusOK, "["+strings.Repeat("0,", maxResponseBytes/2)+"0]"
	if _, err := c.Separate(context.Background(), path); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("huge answer: got %v", err)
	}

	status, body = http.StatusOK, "not json"
	if _, err := c.Separate(context.Background(), path); err == nil {
		t.Fatal("bad json: want an error")
	}
}

func TestDisabledClient(t *testing.T) {
	for _, c := range []*Client{nil, NewClient("", "s"), NewClient("disabled", "s"), NewClient("http://x", "")} {
		if c.Enabled() {
			t.Fatalf("%+v should be disabled", c)
		}
	}
	if _, err := NewClient("", "").Separate(context.Background(), "nope"); err == nil {
		t.Fatal("a disabled client must not send")
	}
}
