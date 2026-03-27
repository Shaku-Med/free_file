package webhook

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"goupload/lib/env"
)

// SeriesPayload carries optional series-linking metadata in the webhook.
type SeriesPayload struct {
	SeriesID       string `json:"series_id,omitempty"`
	SeriesTitle    string `json:"series_title,omitempty"`
	SeriesDesc     string `json:"series_desc,omitempty"`
	SeriesIsPublic *bool  `json:"series_is_public,omitempty"`
	IsSeriesMain   bool   `json:"is_series_main,omitempty"`
	EpisodeNumber  *int   `json:"episode_number,omitempty"`
	SeasonNumber   *int   `json:"season_number,omitempty"`
}

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
	IsAdult          *bool                  `json:"is_adult,omitempty"`
	Colors           []string               `json:"colors,omitempty"`
	Categories       []string               `json:"categories,omitempty"`
	Tags             []string               `json:"tags,omitempty"`
	Metadata         map[string]interface{} `json:"metadata,omitempty"`
	CommentsEnabled  *bool                  `json:"comments_enabled,omitempty"`
	DefaultThumbnail string                 `json:"default_thumbnail,omitempty"`
	Series           SeriesPayload          `json:"series,omitempty"`
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
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[webhook] NotifyJobStatus %s %s: http %d", p.JobID, p.Status, resp.StatusCode)
	} else {
		log.Printf("[webhook] NotifyJobStatus %s %s: success", p.JobID, p.Status)
	}
}
