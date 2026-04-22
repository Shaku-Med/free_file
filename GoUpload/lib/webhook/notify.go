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
	JobID            string                 `json:"job_id"`
	Status           string                 `json:"status"`
	UploadID         string                 `json:"upload_id"`
	UserID           string                 `json:"user_id"`
	FileName         string                 `json:"file_name,omitempty"`
	FileSize         int64                  `json:"file_size,omitempty"`
	IsPublic         *bool                  `json:"is_public,omitempty"`
	Title            string                 `json:"title,omitempty"`
	Description      string                 `json:"description,omitempty"`
	Endpoint         string                 `json:"endpoint,omitempty"`
	Thumbnails       []string               `json:"thumbnails,omitempty"`
	Duration         float64                `json:"duration,omitempty"`
	IsReel           *bool                  `json:"is_reel,omitempty"`
	IsAdult          *bool                  `json:"is_adult,omitempty"`
	Colors           []string               `json:"colors,omitempty"`
	Categories       []string               `json:"categories,omitempty"`
	Tags             []string               `json:"tags,omitempty"`
	Metadata         map[string]interface{} `json:"metadata,omitempty"`
	CommentsEnabled  *bool                  `json:"comments_enabled,omitempty"`
	DefaultThumbnail string                 `json:"default_thumbnail,omitempty"`
	FileSeriesID        string `json:"file_series_id,omitempty"`
	FileSeriesEpisodeID string `json:"file_series_episode_id,omitempty"`
	IsNewSeries         bool   `json:"is_new_series,omitempty"`
	NewEpisodeName      string `json:"new_episode_name,omitempty"`
	ParentEpisodeID     string `json:"parent_episode_id,omitempty"`
	GitHubRepo          string `json:"github_repo,omitempty"`
	// 0–100 while status is running; omitted for queued/completed/failed unless set.
	Progress *int `json:"progress,omitempty"`
}

// NotifyJobStatus sends the payload to the app's /api/upload-job-status.
// The app writes to upload_jobs and files (Supabase). No-op if APP_BASE_URL or UPLOAD_WEBHOOK_SECRET is empty.
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
	req, err := http.NewRequest(http.MethodPost, base+"/api/upload-job-status", bytes.NewReader(body))
	if err != nil {
		log.Printf("[webhook] NotifyJobStatus newrequest: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Secret", secret)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[webhook] NotifyJobStatus %s %s: %v", p.JobID, p.Status, err)
		return
	}
	defer resp.Body.Close()
	bodySnippet, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[webhook] NotifyJobStatus http_error job=%s upload=%s payload_status=%s http=%d body=%q (check APP_BASE_URL, UPLOAD_WEBHOOK_SECRET, and Remix /api/upload-job-status)",
			p.JobID, p.UploadID, p.Status, resp.StatusCode, strings.TrimSpace(string(bodySnippet)))
	} else {
		// payload_status may be "failed" (job failed) while delivery still succeeded — do not log "failed: success".
		log.Printf("[webhook] NotifyJobStatus delivered_ok job=%s upload=%s payload_status=%s http=%d",
			p.JobID, p.UploadID, p.Status, resp.StatusCode)
	}
}

// CommentImagePayload is sent after a comment image is stored in GitHub (same secret as upload-job-status).
type CommentImagePayload struct {
	ImageURL   string `json:"image_url"`
	GitHubRepo string `json:"github_repo"`
}

// NotifyCommentImageStorage upserts path→repo so the app can set comments.image_github_repo when the comment row is created.
func NotifyCommentImageStorage(imageURL, githubRepo string) {
	imageURL = strings.TrimSpace(imageURL)
	githubRepo = strings.TrimSpace(githubRepo)
	if imageURL == "" || githubRepo == "" {
		return
	}
	base := strings.TrimSuffix(env.Get("APP_BASE_URL", ""), "/")
	secret := env.Get("UPLOAD_WEBHOOK_SECRET", "")
	if base == "" || secret == "" {
		log.Printf("[webhook] NotifyCommentImageStorage skipped: APP_BASE_URL=%q secret_set=%v", base, secret != "")
		return
	}
	body, err := json.Marshal(CommentImagePayload{ImageURL: imageURL, GitHubRepo: githubRepo})
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
