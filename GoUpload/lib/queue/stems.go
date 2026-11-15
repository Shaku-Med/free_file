package queue

import (
	"context"
	"encoding/json"
	"time"
)

// Stem separation has its own queue with a single consumer (see jobList).
var stemsList = jobList{key: "stems_jobs", attemptPrefix: "stems:attempts:"}

type StemsJob struct {
	UploadID string `json:"upload_id"`
	UserID   string `json:"user_id"`
	// Prefix is the upload's storage folder, dd_mm_yyyy/<upload>/.
	Prefix    string    `json:"prefix"`
	Duration  float64   `json:"duration"`
	CreatedAt time.Time `json:"created_at"`
}

func (c *Client) PushStemsJob(ctx context.Context, job *StemsJob) error {
	return stemsList.push(ctx, c.rdb, job)
}

// PeekStemsJob works like PeekCaptionJob.
func (c *Client) PeekStemsJob(ctx context.Context) (*StemsJob, string, error) {
	raw, err := stemsList.peek(ctx, c.rdb)
	if err != nil || raw == "" {
		return nil, "", err
	}
	var job StemsJob
	if json.Unmarshal([]byte(raw), &job) != nil {
		return nil, raw, nil
	}
	return &job, raw, nil
}

func (c *Client) RemoveStemsJob(ctx context.Context, raw string) error {
	return stemsList.remove(ctx, c.rdb, raw)
}

func (c *Client) MoveStemsJobLast(ctx context.Context, raw string) error {
	return stemsList.moveLast(ctx, c.rdb, raw)
}

func (c *Client) StemsUploadIDs(ctx context.Context) (map[string]bool, error) {
	return stemsList.uploadIDs(ctx, c.rdb)
}

func (c *Client) StemsAttempt(ctx context.Context, uploadID string) (int64, error) {
	return stemsList.attempt(ctx, c.rdb, uploadID)
}

func (c *Client) UndoStemsAttempt(ctx context.Context, uploadID string) {
	stemsList.undoAttempt(ctx, c.rdb, uploadID)
}

func (c *Client) ClearStemsAttempts(ctx context.Context, uploadID string) {
	stemsList.clearAttempts(ctx, c.rdb, uploadID)
}
