// Package quota asks the app whether a user can still upload N bytes this
// week. Lets the upload server reject early and free disk before the worker
// burns time processing a job that would be rejected anyway.
//
// Auth is the shared UPLOAD_WEBHOOK_SECRET; the same secret the worker uses
// to call /api/upload-job-status. No new keys, no client trust.
package quota

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"goupload/lib/env"
)

type CheckResult struct {
	OK        bool  `json:"ok"`
	Used      int64 `json:"used"`
	Limit     int64 `json:"limit"`
	Remaining int64 `json:"remaining"`
	Predicted int64 `json:"predicted"`
}

type checkRequest struct {
	UserID    string `json:"user_id"`
	Predicted int64  `json:"predicted_bytes"`
}

// ErrUnavailable means we couldn't reach the app. Caller policy: allow on
// transient unavailability (don't punish users for an outage); the webhook
// reconciles real usage when the upload finishes.
var ErrUnavailable = errors.New("quota: app unreachable")

// Check asks the app whether predicted bytes would fit in the user's weekly
// budget. Returns ok=false when over limit; ok=true otherwise.
func Check(ctx context.Context, userID string, predictedBytes int64) (CheckResult, error) {
	base := strings.TrimSuffix(env.Get("APP_BASE_URL", ""), "/")
	secret := env.Get("UPLOAD_WEBHOOK_SECRET", "")
	if base == "" || secret == "" {
		// Not configured. Fail open so dev environments without the app keep working.
		return CheckResult{OK: true}, ErrUnavailable
	}
	body, err := json.Marshal(checkRequest{UserID: userID, Predicted: predictedBytes})
	if err != nil {
		return CheckResult{}, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, base+"/api/internal/quota-check", bytes.NewReader(body))
	if err != nil {
		return CheckResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return CheckResult{OK: true}, ErrUnavailable
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return CheckResult{OK: true}, ErrUnavailable
	}
	var out CheckResult
	if err := json.Unmarshal(rb, &out); err != nil {
		return CheckResult{}, err
	}
	return out, nil
}

// PredictFinalBytes scales the on-disk source size to a conservative estimate
// of the post-processing footprint. Images add small overhead for thumbnails;
// videos add HLS ladder + thumbnail tracks. Aim is 90-100% accuracy on common
// uploads; the webhook reconciles real usage afterwards.
func PredictFinalBytes(actualBytes int64, filename string) int64 {
	if actualBytes <= 0 {
		return 0
	}
	ext := strings.ToLower(filename)
	for _, v := range videoExt {
		if strings.HasSuffix(ext, v) {
			// 1.10x covers most mobile-source HLS + thumbnails within ~200MB tolerance.
			return int64(float64(actualBytes) * 1.10)
		}
	}
	// Image + thumbs.
	return int64(float64(actualBytes) * 1.05)
}

var videoExt = []string{".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v"}

// PurgeUser tells the app to drop every `queued` files row that belongs to
// the user (and refund the quota reservation for each). Called immediately
// after the upload server purges that user's abandoned chunk folders, so the
// DB view of "pending uploads" stops listing rows whose disk data we just
// destroyed.
//
// Best-effort + panic-safe. If the app is unreachable we just log + move on;
// the next `/complete` call from this user will fail the same quota check
// and re-trigger the cleanup. We never want a flaky purge to block the
// 413 response the user is waiting for.
//
// Caller passes the list of uploadIDs whose chunks were just removed; the
// app uses this only as a hint  the broader "delete all queued rows for
// this user" sweep is what actually runs server-side, so a missed uploadID
// here still gets cleaned up.
func PurgeUser(ctx context.Context, userID string, purgedUploadIDs []string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[quota] PurgeUser panic recovered: %v", r)
		}
	}()
	base := strings.TrimSuffix(env.Get("APP_BASE_URL", ""), "/")
	secret := env.Get("UPLOAD_WEBHOOK_SECRET", "")
	if base == "" || secret == "" || userID == "" {
		return
	}
	// Cap the list size before serialising. The app caps it again on its
	// side, but trimming here keeps the request body small and predictable.
	const maxIDs = 256
	ids := purgedUploadIDs
	if len(ids) > maxIDs {
		ids = ids[:maxIDs]
	}
	payload, err := json.Marshal(map[string]interface{}{
		"user_id":            userID,
		"purged_upload_ids":  ids,
	})
	if err != nil {
		return
	}
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, base+"/api/internal/quota-purge", bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<10))
}

// Record reports an upload's actual bytes to the app so it counts toward the
// user's weekly budget. Best-effort + non-blocking: if the app is unreachable
// the upload still succeeds (the weekly limit is advisory for these side
// uploads). Use a unique uploadKey per call so the ledger row is its own line.
//
// Safe to call from a `go Record(...)`: a panic inside this function would
// otherwise take down the whole GoUpload process (Go's default for an
// unrecovered goroutine panic). Caller-side panic safety is captured here so
// every fire-and-forget site doesn't need its own recover.
func Record(ctx context.Context, userID, uploadKey string, byteCount int64) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[quota] Record panic recovered: %v", r)
		}
	}()
	base := strings.TrimSuffix(env.Get("APP_BASE_URL", ""), "/")
	secret := env.Get("UPLOAD_WEBHOOK_SECRET", "")
	if base == "" || secret == "" || userID == "" || uploadKey == "" || byteCount < 0 {
		return
	}
	payload, err := json.Marshal(map[string]interface{}{
		"user_id":   userID,
		"upload_id": uploadKey,
		"bytes":     byteCount,
	})
	if err != nil {
		return
	}
	reqCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, base+"/api/internal/quota-record", bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<10))
}
