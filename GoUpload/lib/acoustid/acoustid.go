// Package acoustid talks to the local AcoustID sidecar (clip -> song match).
// Same trust model as lib/musicdetect: private network, shared secret.
// Disabled (no-op) when ACOUSTID_API_URL is unset.
package acoustid

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	secret  string
	http    *http.Client
}

func NewClient(baseURL, secret string) *Client {
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		secret:  secret,
		http:    &http.Client{Timeout: 60 * time.Second},
	}
}

func (c *Client) Enabled() bool {
	// Secret is optional locally (AcoustID/.env only has the API key; the
	// sidecar skips auth when ACOUSTID_API_SECRET is empty). Compose injects
	// a secret in production and GoUpload sends it when set.
	return c != nil && c.baseURL != "" && c.baseURL != "disabled"
}

// IdentifyJob is the metadata sent with a short MP3 clip.
type IdentifyJob struct {
	JobID          string
	UploadID       string
	UniqueID       string
	UserID         string
	StoragePrefix  string // e.g. "10_08_2026/{uploadID}/" — where cover art is hosted
	ClipStart      float64
	ClipEnd        float64
	SourceDuration float64 // whole-track length in seconds (AcoustID requirement)
	TitleHint      string  // upload title/filename — break same-score AcoustID ties
}

// IdentifyAsync POSTs the clip to /identify. The sidecar queues it and returns
// 202; the lookup runs out-of-band so HLS/upload work is never blocked.
func (c *Client) IdentifyAsync(ctx context.Context, clipPath string, job IdentifyJob) error {
	if !c.Enabled() {
		return nil
	}
	if job.JobID == "" || job.UploadID == "" {
		return fmt.Errorf("acoustid: job_id and upload_id required")
	}
	if job.UniqueID == "" {
		job.UniqueID = job.UploadID
	}

	f, err := os.Open(clipPath)
	if err != nil {
		return err
	}

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		defer f.Close()
		_ = mw.WriteField("job_id", job.JobID)
		_ = mw.WriteField("upload_id", job.UploadID)
		_ = mw.WriteField("unique_id", job.UniqueID)
		_ = mw.WriteField("user_id", job.UserID)
		_ = mw.WriteField("storage_prefix", job.StoragePrefix)
		_ = mw.WriteField("clip_start", strconv.FormatFloat(job.ClipStart, 'f', 3, 64))
		_ = mw.WriteField("clip_end", strconv.FormatFloat(job.ClipEnd, 'f', 3, 64))
		if job.SourceDuration > 0 {
			_ = mw.WriteField("source_duration", strconv.FormatFloat(job.SourceDuration, 'f', 3, 64))
		}
		if hint := strings.TrimSpace(job.TitleHint); hint != "" {
			if len(hint) > 300 {
				hint = hint[:300]
			}
			_ = mw.WriteField("title_hint", hint)
		}
		part, perr := mw.CreateFormFile("file", filepath.Base(clipPath))
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

	url := c.baseURL + "/identify"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, pr)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Internal-Secret", c.secret)

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("acoustid request failed: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusAccepted && res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("acoustid HTTP %d: %s", res.StatusCode, string(snippet))
	}
	return nil
}

// Cancel asks the sidecar to drop a queued / in-flight job for this upload job id.
func (c *Client) Cancel(ctx context.Context, jobID string) error {
	if !c.Enabled() || jobID == "" {
		return nil
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("job_id", jobID); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/cancel", &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Internal-Secret", c.secret)

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("acoustid cancel failed: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("acoustid cancel HTTP %d: %s", res.StatusCode, string(snippet))
	}
	return nil
}
