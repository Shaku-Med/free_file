// Package musicdetect talks to the local MusicDetector sidecar (audio -> is_music).
// Same trust model as lib/embed: private network, shared secret, never the
// internet. Disabled (no-op) when MUSIC_API_URL is unset so dev environments
// without the sidecar keep working.
package musicdetect

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type Client struct {
	apiURL string
	secret string
	http   *http.Client
}

func NewClient(apiURL, secret string) *Client {
	return &Client{
		apiURL: apiURL,
		secret: secret,
		// Inference on a few minutes of audio (1 vCPU) plus possible queue wait;
		// the sidecar returns 503 quickly when full, so this rarely blocks long.
		http: &http.Client{Timeout: 150 * time.Second},
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.apiURL != "" && c.apiURL != "disabled" && c.secret != ""
}

// Segment is a labelled time range from inaSpeechSegmenter (seconds from clip start).
type Segment struct {
	Label string  `json:"label"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

// Result is the subset of the sidecar's /analyze response we act on.
type Result struct {
	IsMusic      bool      `json:"is_music"`
	MusicRatio   float64   `json:"music_ratio"`
	MusicSeconds float64   `json:"music_seconds"`
	Stub         bool      `json:"stub"`
	Segments     []Segment `json:"segments"`
}

// BestMusicWindow picks the longest contiguous "music" segment that is at least
// minSec long, then caps its length at maxSec (AcoustID guidance: first ~120s).
// Returns ok=false when nothing usable is present.
func (r *Result) BestMusicWindow(minSec, maxSec float64) (start, end float64, ok bool) {
	if r == nil || maxSec <= 0 {
		return 0, 0, false
	}
	if minSec < 0 {
		minSec = 0
	}
	var bestStart, bestEnd, bestDur float64
	found := false
	for _, seg := range r.Segments {
		if seg.Label != "music" {
			continue
		}
		dur := seg.End - seg.Start
		if dur < minSec {
			continue
		}
		if !found || dur > bestDur {
			bestStart, bestEnd, bestDur = seg.Start, seg.End, dur
			found = true
		}
	}
	if !found {
		return 0, 0, false
	}
	if bestDur > maxSec {
		bestEnd = bestStart + maxSec
	}
	return bestStart, bestEnd, true
}

// Classify streams the audio file at path to the sidecar and returns its is_music
// verdict. Returns nil,nil when disabled.
func (c *Client) Classify(ctx context.Context, path string) (*Result, error) {
	if !c.Enabled() {
		return nil, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		defer f.Close()
		part, perr := mw.CreateFormFile("file", filepath.Base(path))
		if perr != nil {
			_ = pw.CloseWithError(perr)
			return
		}
		if _, cerr := io.Copy(part, f); cerr != nil {
			_ = pw.CloseWithError(cerr)
			return
		}
		_ = pw.CloseWithError(mw.Close())
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL, pr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Internal-Secret", c.secret)

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("music api request failed: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return nil, fmt.Errorf("music api HTTP %d: %s", res.StatusCode, string(snippet))
	}

	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var out Result
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
