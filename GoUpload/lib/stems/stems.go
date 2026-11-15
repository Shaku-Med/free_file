// Package stems talks to the StemsAPI sidecar, which separates a track into
// drums, bass, other and vocals with Demucs and measures each instrument band
// of the result. Same trust model as lib/musicdetect: private network, shared
// secret, never the internet. Disabled when STEMS_API_URL is unset.
package stems

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"goupload/lib/ffmpeg"
)

// ErrBusy means the sidecar is already working on as many tracks as it takes.
var ErrBusy = errors.New("stems api busy")

// A 20 minute track at ~43 frames a second, five bands of short numbers.
const maxResponseBytes = 16 << 20

type Client struct {
	apiURL string
	secret string
	http   *http.Client
}

func NewClient(apiURL, secret string) *Client {
	return &Client{
		apiURL: apiURL,
		secret: secret,
		// Separation runs at about real time on two cores; the caller's context
		// sets the real deadline per track.
		http: &http.Client{Timeout: 90 * time.Minute},
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.apiURL != "" && c.apiURL != "disabled" && c.secret != ""
}

// Separate sends the FLAC file at path to the sidecar as the raw request body
// and returns its band curves. They still need ffmpeg.StemsDocFromSeparated
// to be checked.
func (c *Client) Separate(ctx context.Context, path string) (*ffmpeg.SeparatedBands, error) {
	if !c.Enabled() {
		return nil, errors.New("stems api disabled")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL, f)
	if err != nil {
		return nil, err
	}
	req.ContentLength = info.Size()
	req.Header.Set("Content-Type", "audio/flac")
	req.Header.Set("X-Internal-Secret", c.secret)

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stems api request failed: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusServiceUnavailable {
		return nil, ErrBusy
	}
	if res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return nil, fmt.Errorf("stems api HTTP %d: %s", res.StatusCode, string(snippet))
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxResponseBytes {
		return nil, errors.New("stems api answer too large")
	}
	var out ffmpeg.SeparatedBands
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("stems api answer: %w", err)
	}
	return &out, nil
}
