package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

// Auto captions have their own queue with a single consumer. A job stays on
// the list until it is finished, so one a deploy interrupts is simply picked up
// again; the attempts counter stops one that keeps failing from looping.
const (
	captionsQueueKey     = "captions_jobs"
	captionAttemptPrefix = "captions:attempts:"
	captionAttemptTTL    = 7 * 24 * time.Hour
)

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
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return c.rdb.RPush(ctx, captionsQueueKey, data).Err()
}

// PeekCaptionJob returns the job at the front without taking it off, with its
// raw form for RemoveCaptionJob. raw is "" when the queue is empty; job is nil
// with a non empty raw when the entry can't be read.
func (c *Client) PeekCaptionJob(ctx context.Context) (*CaptionJob, string, error) {
	raw, err := c.rdb.LIndex(ctx, captionsQueueKey, 0).Result()
	if err == redis.Nil {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	var job CaptionJob
	if json.Unmarshal([]byte(raw), &job) != nil {
		return nil, raw, nil
	}
	return &job, raw, nil
}

func (c *Client) RemoveCaptionJob(ctx context.Context, raw string) error {
	return c.rdb.LRem(ctx, captionsQueueKey, 1, raw).Err()
}

// MoveCaptionJobLast sends a job that has to wait to the back, so it doesn't
// hold up the ones behind it.
func (c *Client) MoveCaptionJobLast(ctx context.Context, raw string) error {
	if err := c.rdb.LRem(ctx, captionsQueueKey, 1, raw).Err(); err != nil {
		return err
	}
	return c.rdb.RPush(ctx, captionsQueueKey, raw).Err()
}

func (c *Client) CaptionUploadIDs(ctx context.Context) (map[string]bool, error) {
	raw, err := c.rdb.LRange(ctx, captionsQueueKey, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(raw))
	for _, r := range raw {
		var j CaptionJob
		if json.Unmarshal([]byte(r), &j) == nil && j.UploadID != "" {
			ids[j.UploadID] = true
		}
	}
	return ids, nil
}

// CaptionAttempt counts one more start of this upload's transcription.
func (c *Client) CaptionAttempt(ctx context.Context, uploadID string) (int64, error) {
	key := captionAttemptPrefix + uploadID
	n, err := c.rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	_ = c.rdb.Expire(ctx, key, captionAttemptTTL).Err()
	return n, nil
}

// UndoCaptionAttempt takes back a start that a shutdown cut short.
func (c *Client) UndoCaptionAttempt(ctx context.Context, uploadID string) {
	_ = c.rdb.Decr(ctx, captionAttemptPrefix+uploadID).Err()
}

func (c *Client) ClearCaptionAttempts(ctx context.Context, uploadID string) {
	_ = c.rdb.Del(ctx, captionAttemptPrefix+uploadID).Err()
}
