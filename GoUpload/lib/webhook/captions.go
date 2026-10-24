package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"goupload/lib/env"
)

// AutoCaptions tells the app a caption track was made for an upload.
type AutoCaptions struct {
	UploadID string `json:"upload_id"`
	UserID   string `json:"user_id"`
	Language string `json:"language"`
	Path     string `json:"path"`
}

// ErrCaptionsRejected means the app refused the track for good: the upload is
// gone, or its owner already has captions in that language.
var ErrCaptionsRejected = errors.New("rejected by the app")

// SendAutoCaptions makes one attempt; the captions queue does the retrying.
// Any error other than ErrCaptionsRejected is worth trying again later.
func SendAutoCaptions(ctx context.Context, p AutoCaptions) error {
	base := strings.TrimSuffix(env.Get("APP_BASE_URL", ""), "/")
	secret := env.Get("UPLOAD_WEBHOOK_SECRET", "")
	if base == "" || secret == "" {
		return errors.New("APP_BASE_URL or UPLOAD_WEBHOOK_SECRET is not set")
	}
	body, err := json.Marshal(p)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/internal/captions/auto", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", secret)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode >= 500 || resp.StatusCode == 408 || resp.StatusCode == 429:
		return fmt.Errorf("app http %d", resp.StatusCode)
	default:
		return fmt.Errorf("%w: http %d %s", ErrCaptionsRejected, resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
}
