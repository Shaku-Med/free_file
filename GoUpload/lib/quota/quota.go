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
	// Extra weekly allowance that opens once the monthly budget is full.
	// When OK is false but OverflowOK is true the upload is still accepted
	// and routed to the overflow storage backend.
	OverflowOK        bool  `json:"overflow_ok"`
	OverflowUsed      int64 `json:"overflow_used"`
	OverflowLimit     int64 `json:"overflow_limit"`
	OverflowRemaining int64 `json:"overflow_remaining"`
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

// PredictFinalBytes returns a CONSERVATIVE upper bound on the post-processing
// footprint of an upload. Used at /complete to decide whether to enqueue the
// job or reject it before the worker burns time + storage.
//
// The previous version applied a flat 1.10x to every video, which was wildly
// optimistic  a 1080p source actually triples in size once the HLS ladder
// (360p + 480p + 720p + source-tier) is generated. That gap let users sneak
// 10 GB uploads through with 2 GB of quota left because we were measuring the
// SOURCE size against the limit, not what we'd actually end up storing.
//
// New model: multiplier scales with the source resolution because that's
// what determines which HLS tiers `selectTiers` will produce. Pass 0 for
// srcHeight when the resolution is unknown (probe failed)  we fall back
// to the most conservative video multiplier so we err on rejection rather
// than letting an over-budget file slip through.
//
// Multipliers calibrated against the ladder defined in lib/ffmpeg/hls.go
// (360p/480p/720p/1080p/1440p/2160p/4320p with MaxRates 1/1.5/3/5/10/20/40 Mbps).
// The "source" tier inherits the matching tier's MaxRate cap, so total
// stored ≈ Σ(tier MaxRate) × duration, expressed below as a multiple of
// source size. A small extra 0.05x covers thumbnails + waveform + master
// playlists.
func PredictFinalBytes(actualBytes int64, filename string, srcHeight int) int64 {
	if actualBytes <= 0 {
		return 0
	}
	ext := strings.ToLower(filename)
	isVideo := false
	for _, v := range videoExt {
		if strings.HasSuffix(ext, v) {
			isVideo = true
			break
		}
	}
	if !isVideo {
		// Image + thumbnail variants. Small fixed overhead.
		return int64(float64(actualBytes) * 1.10)
	}

	mult := videoMultiplierForHeight(srcHeight)
	return int64(float64(actualBytes) * mult)
}

// videoMultiplierForHeight returns the source-size multiplier we expect
// after the HLS ladder fans out for a video of the given resolution.
// Heights are matched to the largest tier whose Height <= srcHeight; if
// srcHeight is 0 / unknown we use the worst-case (8K-source) multiplier.
//
// Tuning rationale (see hls.go for the exact ladder):
//   - At each tier the ffmpeg encode is bitrate-capped, so per-tier output
//     ≈ tier MaxRate × duration. We approximate that as a fraction of the
//     SOURCE size by ratioing the tier MaxRate against the source-equivalent
//     tier's MaxRate.
//   - We always include a thumbnails / manifests overhead of +0.05x.
//   - Every value is rounded UP to keep the predictor conservative  if
//     the real output ends up smaller, the worst that happens is a
//     quota-rejected upload that *would have* fit; the user can retry.
func videoMultiplierForHeight(srcHeight int) float64 {
	switch {
	case srcHeight <= 0:
		// Unknown source resolution (probe failed / moov-at-end / weird format).
		// Use the worst plausible case so an 8K upload can't slip through.
		return 4.0
	case srcHeight >= 4320:
		// 8K source: 360 + 480 + 720 + 1080 + 4320 (pruned to 5 tiers).
		return 4.0
	case srcHeight >= 2160:
		// 4K source: 360 + 480 + 720 + 1080 + 2160. Σbitrate ≈ 30.5 Mbps.
		return 3.5
	case srcHeight >= 1440:
		// 2K source: 360 + 480 + 720 + 1080 + 1440. Σbitrate ≈ 20.5 Mbps.
		return 3.2
	case srcHeight >= 1080:
		// 1080p source: 360 + 480 + 720 + 1080. Σbitrate ≈ 10.5 Mbps.
		// User-reported empirical: 1 GB source → ~3 GB stored.
		return 3.0
	case srcHeight >= 720:
		// 720p source: 360 + 480 + 720. Σbitrate ≈ 5.5 Mbps.
		return 2.4
	case srcHeight >= 480:
		// 480p source: 360 + 480.
		return 1.8
	case srcHeight >= 360:
		// 360p source: source-tier only after ladder runs.
		return 1.3
	default:
		// Tiny source (sub-360p). Almost a passthrough, just thumbs overhead.
		return 1.2
	}
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
