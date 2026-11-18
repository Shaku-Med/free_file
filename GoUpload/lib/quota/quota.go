// Package quota asks the app whether a user can still upload N bytes this
// month, and reserves room for a finished upload before it is queued.
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

// ErrUnavailable means the app could not answer. Callers reject the upload:
// storage is paid for, so an unchecked upload is never let through.
var ErrUnavailable = errors.New("quota: app unreachable")

type admitRequest struct {
	Action   string `json:"action"`
	UserID   string `json:"user_id"`
	UploadID string `json:"upload_id"`
	Bytes    int64  `json:"bytes,omitempty"`
}

// Check asks the app whether bytes would fit in the user's monthly budget,
// without reserving anything. Any error means the answer is unknown and the
// upload must wait.
func Check(ctx context.Context, userID string, byteCount int64) (CheckResult, error) {
	var out CheckResult
	err := post(ctx, "/api/internal/quota-check", checkRequest{UserID: userID, Predicted: byteCount}, &out)
	return out, err
}

// Admit lets a finished upload in when the file itself fits in what the user
// has left, and reserves that much so two uploads cannot share the same room.
// Processing may store more than the file's size; the app caps that charge at
// what was left. Calling it again for the same upload changes nothing.
func Admit(ctx context.Context, userID, uploadID string, fileBytes int64) (CheckResult, error) {
	var out CheckResult
	err := post(ctx, "/api/internal/quota-admit", admitRequest{Action: "admit", UserID: userID, UploadID: uploadID, Bytes: fileBytes}, &out)
	return out, err
}

// Release gives back an admission whose upload never got queued.
func Release(ctx context.Context, userID, uploadID string) error {
	return post(ctx, "/api/internal/quota-admit", admitRequest{Action: "release", UserID: userID, UploadID: uploadID}, nil)
}

func post(ctx context.Context, path string, payload, out any) error {
	base := strings.TrimSuffix(env.Get("APP_BASE_URL", ""), "/")
	secret := env.Get("UPLOAD_WEBHOOK_SECRET", "")
	if base == "" || secret == "" {
		return ErrUnavailable
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ErrUnavailable
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(rb, out); err != nil {
		return ErrUnavailable
	}
	return nil
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
