package webhook

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"goupload/lib/env"
)

// Payload is sent to the app's /api/upload-job-status. The app upserts upload_jobs
// and creates/updates files in Supabase so the user sees progress on their page.
type Payload struct {
	JobID    string `json:"job_id"`
	Status   string `json:"status"`
	UploadID string `json:"upload_id"`
	UserID   string `json:"user_id"`
	FileName string `json:"file_name,omitempty"`
	FileSize int64  `json:"file_size,omitempty"`
	IsPublic *bool  `json:"is_public,omitempty"`
	// Uploader's chosen visibility, already validated against the allowlist in
	// the upload handler. Empty when the client did not send one.
	Visibility  string   `json:"visibility,omitempty"`
	Title       string   `json:"title,omitempty"`
	Description string   `json:"description,omitempty"`
	Endpoint    string   `json:"endpoint,omitempty"`
	Thumbnails  []string `json:"thumbnails,omitempty"`
	Duration    float64  `json:"duration,omitempty"`
	IsReel      *bool    `json:"is_reel,omitempty"`
	IsAdult     *bool    `json:"is_adult,omitempty"`
	// Moderation verdict from the vision pass: "adult", "harmful", or empty.
	// The app forces adult -> unlisted and harmful -> private, and LOCKS the
	// file's visibility in both cases. Sent only over the webhook-secret
	// channel, so a client can never assert this about its own upload.
	ContentFlag        string                 `json:"content_flag,omitempty"`
	ModerationEvidence map[string]interface{} `json:"moderation_evidence,omitempty"`
	Colors             []string               `json:"colors,omitempty"`
	Categories         []string               `json:"categories,omitempty"`
	Tags               []string               `json:"tags,omitempty"`
	Metadata           map[string]interface{} `json:"metadata,omitempty"`
	CommentsEnabled    *bool                  `json:"comments_enabled,omitempty"`
	DefaultThumbnail   string                 `json:"default_thumbnail,omitempty"`
	// Storage path of the hover preview MP4, empty when it was not produced.
	PreviewEndpoint     string `json:"preview_endpoint,omitempty"`
	FileSeriesID        string `json:"file_series_id,omitempty"`
	FileSeriesEpisodeID string `json:"file_series_episode_id,omitempty"`
	IsNewSeries         bool   `json:"is_new_series,omitempty"`
	NewEpisodeName      string `json:"new_episode_name,omitempty"`
	ParentEpisodeID     string `json:"parent_episode_id,omitempty"`
	GitHubRepo          string `json:"github_repo,omitempty"`
	// Storage backend the worker wrote to ("github" or "r2"); bucket set for r2.
	StorageBackend string `json:"storage_backend,omitempty"`
	StorageBucket  string `json:"storage_bucket,omitempty"`
	// True when this upload was accepted on the extra weekly allowance; the
	// app meters it under the overflow scope instead of the monthly budget.
	Overflow bool `json:"overflow,omitempty"`
	// Semantic-search vector (bge-small, 384 dims) computed at processing
	// time from title/description/tags/AI caption. The app stores it on the
	// files row; omitted when the embed sidecar is disabled or failed.
	Embedding []float32 `json:"embedding,omitempty"`
	// True when the file is detected as music (beat-regularity score or a
	// "music" category). Drives the card music icon and on-theme recommends.
	IsMusic bool `json:"is_music,omitempty"`
	// ISO 639-3 code of the title/description language (e.g. "eng", "cmn"),
	// detected at processing time. Feeds same-language recommendations.
	ContentLanguage string `json:"content_language,omitempty"`
	// Audio fingerprint result. Matching now runs ON THE VPS (SQLite) so the
	// raw hashes never leave the box; the app only records the resulting link.
	// FpProcessed is true when fingerprint matching ran for this upload;
	// OriginalUniqueID is the matched original's unique_id (empty = no match →
	// the app clears original_file_id). When FpProcessed is false the app
	// leaves original_file_id untouched.
	FpProcessed      bool   `json:"fp_processed,omitempty"`
	OriginalUniqueID string `json:"original_unique_id,omitempty"`
	// 0–100 while status is running; omitted for queued/completed/failed unless set.
	Progress *int `json:"progress,omitempty"`
}

// terminalStatuses are payload statuses we MUST land in the DB for the row
// to ever recover. A dropped 'queued' / 'running' update is annoying but
// self-healing (the next status push overwrites it). A dropped 'completed'
// or 'failed' update leaves the files row stranded at upload_status='running'
// /  processing_progress=N forever  exactly the "stuck at 85%" bug this
// retry loop exists to prevent.
var terminalStatuses = map[string]struct{}{
	"completed": {},
	"failed":    {},
}

// NotifyJobStatus sends the payload to the app's /api/upload-job-status.
// The app writes to upload_jobs and files (Supabase). No-op if APP_BASE_URL or UPLOAD_WEBHOOK_SECRET is empty.
//
// Delivery semantics:
//   - "queued" / "running" updates fire once, best-effort. Losing one is
//     fine: progress events arrive frequently and the next one overwrites.
//   - "completed" / "failed" updates are RETRIED with exponential backoff
//     until they land (or we hit the cap). Losing one of these would
//     strand the files row at 'running' state forever  the user sees a
//     stuck "85%" with no way out except a manual SQL UPDATE.
//
// Retries are bounded (max ~30s total) so a permanently broken app doesn't
// pin a worker goroutine; if every attempt fails we log loud enough to
// notice and the SQL recovery query (see operator notes) can sweep stuck
// rows after the fact.
func NotifyJobStatus(p Payload) {
	base := strings.TrimSuffix(env.Get("APP_BASE_URL", ""), "/")
	secret := env.Get("UPLOAD_WEBHOOK_SECRET", "")
	if base == "" || secret == "" {
		log.Printf("[webhook] NotifyJobStatus skipped: APP_BASE_URL=%q UPLOAD_WEBHOOK_SECRET=%v", base, secret != "")
		return
	}
	log.Printf("[webhook] NotifyJobStatus sending job=%s status=%s upload=%s user=%s", p.JobID, p.Status, p.UploadID, p.UserID)
	body, err := json.Marshal(p)
	if err != nil {
		log.Printf("[webhook] NotifyJobStatus marshal: %v", err)
		return
	}

	_, isTerminal := terminalStatuses[p.Status]
	// Non-terminal updates: one shot, fast fail. Terminal updates: 5 tries
	// with 1s/2s/4s/8s backoff (max ~15s sleep + per-call timeouts ≈ 30s
	// upper bound; well under any sane HTTP timeout the caller might have).
	attempts := 1
	if isTerminal {
		attempts = 5
	}
	backoff := time.Second

	url := base + "/api/upload-job-status"
	client := &http.Client{Timeout: 10 * time.Second}

	for i := 0; i < attempts; i++ {
		req, rerr := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
		if rerr != nil {
			log.Printf("[webhook] NotifyJobStatus newrequest: %v", rerr)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Webhook-Secret", secret)

		resp, derr := client.Do(req)
		if derr != nil {
			log.Printf("[webhook] NotifyJobStatus attempt=%d/%d job=%s upload=%s payload_status=%s transport_err=%v",
				i+1, attempts, p.JobID, p.UploadID, p.Status, derr)
		} else {
			bodySnippet, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				log.Printf("[webhook] NotifyJobStatus delivered_ok attempt=%d/%d job=%s upload=%s payload_status=%s http=%d",
					i+1, attempts, p.JobID, p.UploadID, p.Status, resp.StatusCode)
				return
			}
			// 4xx other than 408/429 won't ever succeed on retry  the body
			// is malformed or the secret is wrong. Don't burn budget retrying.
			retriable := resp.StatusCode >= 500 || resp.StatusCode == 408 || resp.StatusCode == 429
			log.Printf("[webhook] NotifyJobStatus attempt=%d/%d job=%s upload=%s payload_status=%s http=%d retriable=%v body=%q",
				i+1, attempts, p.JobID, p.UploadID, p.Status, resp.StatusCode, retriable, strings.TrimSpace(string(bodySnippet)))
			if !retriable {
				if isTerminal {
					// Same stranded row as an exhausted retry, so it needs the
					// same loud line. A silent return here is how a rejected
					// "completed" left the file stuck at 95% with nothing in the
					// logs that reads like a failure.
					log.Printf("[webhook] NotifyJobStatus REJECTED job=%s upload=%s payload_status=%s http=%d  files row may be stuck; run the recovery SQL",
						p.JobID, p.UploadID, p.Status, resp.StatusCode)
				}
				return
			}
		}

		// Don't sleep after the final attempt.
		if i+1 >= attempts {
			break
		}
		time.Sleep(backoff)
		backoff *= 2
	}

	if isTerminal {
		// Loud final-failure log so the operator can sweep stuck rows.
		log.Printf("[webhook] NotifyJobStatus EXHAUSTED job=%s upload=%s payload_status=%s  files row may be stuck; run the recovery SQL",
			p.JobID, p.UploadID, p.Status)
	}
}

// CommentImagePayload is sent after a comment image is stored (same secret as upload-job-status).
type CommentImagePayload struct {
	ImageURL       string `json:"image_url"`
	GitHubRepo     string `json:"github_repo"`
	StorageBackend string `json:"storage_backend,omitempty"`
}

// NotifyCommentImageStorage upserts path→(repo, backend) so the app can set the
// comment row's storage fields when it's created. For R2, githubRepo is "".
func NotifyCommentImageStorage(imageURL, githubRepo, storageBackend string) {
	imageURL = strings.TrimSpace(imageURL)
	githubRepo = strings.TrimSpace(githubRepo)
	storageBackend = strings.TrimSpace(storageBackend)
	if storageBackend == "" {
		storageBackend = "github"
	}
	// Need at least a path; GitHub also needs a repo, R2 does not.
	if imageURL == "" || (storageBackend == "github" && githubRepo == "") {
		return
	}
	base := strings.TrimSuffix(env.Get("APP_BASE_URL", ""), "/")
	secret := env.Get("UPLOAD_WEBHOOK_SECRET", "")
	if base == "" || secret == "" {
		log.Printf("[webhook] NotifyCommentImageStorage skipped: APP_BASE_URL=%q secret_set=%v", base, secret != "")
		return
	}
	body, err := json.Marshal(CommentImagePayload{ImageURL: imageURL, GitHubRepo: githubRepo, StorageBackend: storageBackend})
	if err != nil {
		log.Printf("[webhook] NotifyCommentImageStorage marshal: %v", err)
		return
	}
	req, err := http.NewRequest(http.MethodPost, base+"/api/webhooks/comment-image-storage", bytes.NewReader(body))
	if err != nil {
		log.Printf("[webhook] NotifyCommentImageStorage newrequest: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", secret)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[webhook] NotifyCommentImageStorage %s: %v", imageURL, err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[webhook] NotifyCommentImageStorage %s: http %d", imageURL, resp.StatusCode)
	} else {
		log.Printf("[webhook] NotifyCommentImageStorage %s: success", imageURL)
	}
}
