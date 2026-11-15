package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

// jobList is a queue of background jobs after an upload (auto captions, stem
// separation), each with a single consumer. A job stays on the list until it
// is finished, so one a deploy interrupts is simply picked up again; the
// attempts counter stops one that keeps failing from looping.
type jobList struct {
	key           string
	attemptPrefix string
}

const jobAttemptTTL = 7 * 24 * time.Hour

func (l jobList) push(ctx context.Context, rdb *redis.Client, job any) error {
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return rdb.RPush(ctx, l.key, data).Err()
}

// peek returns the raw job at the front without taking it off; "" when empty.
func (l jobList) peek(ctx context.Context, rdb *redis.Client) (string, error) {
	raw, err := rdb.LIndex(ctx, l.key, 0).Result()
	if err == redis.Nil {
		return "", nil
	}
	return raw, err
}

func (l jobList) remove(ctx context.Context, rdb *redis.Client, raw string) error {
	return rdb.LRem(ctx, l.key, 1, raw).Err()
}

// moveLast sends a job that has to wait to the back, so it doesn't hold up
// the ones behind it.
func (l jobList) moveLast(ctx context.Context, rdb *redis.Client, raw string) error {
	if err := rdb.LRem(ctx, l.key, 1, raw).Err(); err != nil {
		return err
	}
	return rdb.RPush(ctx, l.key, raw).Err()
}

// uploadIDs is every upload with a job waiting.
func (l jobList) uploadIDs(ctx context.Context, rdb *redis.Client) (map[string]bool, error) {
	raw, err := rdb.LRange(ctx, l.key, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	ids := make(map[string]bool, len(raw))
	for _, r := range raw {
		var j struct {
			UploadID string `json:"upload_id"`
		}
		if json.Unmarshal([]byte(r), &j) == nil && j.UploadID != "" {
			ids[j.UploadID] = true
		}
	}
	return ids, nil
}

// attempt counts one more start of this upload's job.
func (l jobList) attempt(ctx context.Context, rdb *redis.Client, uploadID string) (int64, error) {
	key := l.attemptPrefix + uploadID
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	_ = rdb.Expire(ctx, key, jobAttemptTTL).Err()
	return n, nil
}

// undoAttempt takes back a start that a shutdown cut short.
func (l jobList) undoAttempt(ctx context.Context, rdb *redis.Client, uploadID string) {
	_ = rdb.Decr(ctx, l.attemptPrefix+uploadID).Err()
}

func (l jobList) clearAttempts(ctx context.Context, rdb *redis.Client, uploadID string) {
	_ = rdb.Del(ctx, l.attemptPrefix+uploadID).Err()
}
