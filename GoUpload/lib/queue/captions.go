package queue

import (
	"context"
	"encoding/json"
	"time"
)

// Auto captions have their own queue with a single consumer (see jobList).
var captionsList = jobList{key: "captions_jobs", attemptPrefix: "captions:attempts:"}

type CaptionJob struct {
	UploadID string `json:"upload_id"`
	UserID   string `json:"user_id"`
	// Prefix is the upload's storage folder, dd_mm_yyyy/<upload>/.
	Prefix    string    `json:"prefix"`
	Duration  float64   `json:"duration"`
	CreatedAt time.Time `json:"created_at"`
	// Song is set when the music detector called it music: lyrics are
	// transcribed differently from speech.
	Song bool `json:"song,omitempty"`
}

func (c *Client) PushCaptionJob(ctx context.Context, job *CaptionJob) error {
	return captionsList.push(ctx, c.rdb, job)
}

// PeekCaptionJob returns the job at the front without taking it off, with its
// raw form for RemoveCaptionJob. raw is "" when the queue is empty; job is nil
// with a non empty raw when the entry can't be read.
func (c *Client) PeekCaptionJob(ctx context.Context) (*CaptionJob, string, error) {
	raw, err := captionsList.peek(ctx, c.rdb)
	if err != nil || raw == "" {
		return nil, "", err
	}
	var job CaptionJob
	if json.Unmarshal([]byte(raw), &job) != nil {
		return nil, raw, nil
	}
	return &job, raw, nil
}

func (c *Client) RemoveCaptionJob(ctx context.Context, raw string) error {
	return captionsList.remove(ctx, c.rdb, raw)
}

func (c *Client) MoveCaptionJobLast(ctx context.Context, raw string) error {
	return captionsList.moveLast(ctx, c.rdb, raw)
}

func (c *Client) CaptionUploadIDs(ctx context.Context) (map[string]bool, error) {
	return captionsList.uploadIDs(ctx, c.rdb)
}

func (c *Client) CaptionAttempt(ctx context.Context, uploadID string) (int64, error) {
	return captionsList.attempt(ctx, c.rdb, uploadID)
}

func (c *Client) UndoCaptionAttempt(ctx context.Context, uploadID string) {
	captionsList.undoAttempt(ctx, c.rdb, uploadID)
}

func (c *Client) ClearCaptionAttempts(ctx context.Context, uploadID string) {
	captionsList.clearAttempts(ctx, c.rdb, uploadID)
}
