package queue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

type Client struct {
	rdb       *redis.Client
	queueName string
}

// ReelMode is the user's chosen reel intent for an upload.
//
//	"auto"  server picks based on duration + aspect ratio (default)
//	"yes"   force is_reel=true (refused when duration > 3 min)
//	"no"    force is_reel=false regardless of shape/length
//
// Locked at upload time; can't be edited after the file ships.
type Job struct {
	ID                  string   `json:"id"`
	UserID              string   `json:"user_id"`
	UploadID            string   `json:"upload_id"`
	FileName            string   `json:"file_name"`
	FileSize            int64    `json:"file_size"`
	TotalChunks         int      `json:"total_chunks"`
	Title               string   `json:"title,omitempty"`
	Description         string   `json:"description,omitempty"`
	UserCategories      []string `json:"user_categories,omitempty"`
	UserTags            []string `json:"user_tags,omitempty"`
	DefaultThumbnail    string   `json:"default_thumbnail,omitempty"`
	ReelMode            string   `json:"reel_mode,omitempty"`
	FileSeriesID        string   `json:"file_series_id,omitempty"`
	FileSeriesEpisodeID string   `json:"file_series_episode_id,omitempty"`
	IsNewSeries         bool     `json:"is_new_series"`
	NewEpisodeName      string   `json:"new_episode_name,omitempty"`
	ParentEpisodeID     string   `json:"parent_episode_id,omitempty"`
	// Overflow: accepted on the extra weekly allowance after the monthly
	// quota filled. The worker forces the GitHub backend for these jobs.
	Overflow  bool      `json:"overflow,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func NewClient(addr, password string, db int, queueName string) (*Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	if queueName == "" {
		queueName = "upload_jobs"
	}
	return &Client{rdb: rdb, queueName: queueName}, nil
}

func (c *Client) Enqueue(ctx context.Context, userID, uploadID, fileName string, fileSize int64, totalChunks int, title, description string, userCategories, userTags []string, defaultThumbnail, reelMode string, fileSeriesID, fileSeriesEpisodeID string, isNewSeries bool, newEpisodeName, parentEpisodeID string, overflow bool) (string, error) {
	// Reject unknown reel modes early  silent fallthrough to "auto" is
	// safer than dropping the upload, but log-worthy for the caller.
	switch reelMode {
	case "", "auto", "yes", "no":
		// ok
	default:
		reelMode = "auto"
	}
	jobID := newJobID()
	job := Job{
		ID:                  jobID,
		UserID:              userID,
		UploadID:            uploadID,
		FileName:            fileName,
		FileSize:            fileSize,
		TotalChunks:         totalChunks,
		Title:               title,
		Description:         description,
		UserCategories:      userCategories,
		UserTags:            userTags,
		DefaultThumbnail:    defaultThumbnail,
		ReelMode:            reelMode,
		FileSeriesID:        fileSeriesID,
		FileSeriesEpisodeID: fileSeriesEpisodeID,
		IsNewSeries:         isNewSeries,
		NewEpisodeName:      newEpisodeName,
		ParentEpisodeID:     parentEpisodeID,
		Overflow:            overflow,
		CreatedAt:           time.Now().UTC(),
	}
	data, err := json.Marshal(job)
	if err != nil {
		return "", err
	}
	if err := c.rdb.RPush(ctx, c.queueName, data).Err(); err != nil {
		return "", err
	}
	return jobID, nil
}

func (c *Client) Dequeue(ctx context.Context, timeout time.Duration) (*Job, error) {
	result, err := c.rdb.BLPop(ctx, timeout, c.queueName).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}
	if len(result) < 2 {
		return nil, nil
	}
	var job Job
	if err := json.Unmarshal([]byte(result[1]), &job); err != nil {
		return nil, err
	}
	return &job, nil
}

func (c *Client) Close() error {
	return c.rdb.Close()
}

// Redis exposes the underlying client for shared features (e.g. rate limits) using the same connection.
func (c *Client) Redis() *redis.Client {
	return c.rdb
}

const jobStatusKeyPrefix = "upload:job:status:"

func (c *Client) SetJobStatus(ctx context.Context, jobID, status string) error {
	if jobID == "" || status == "" {
		return nil
	}
	return c.rdb.Set(ctx, jobStatusKeyPrefix+jobID, status, 7*24*time.Hour).Err()
}

func (c *Client) GetJobStatus(ctx context.Context, jobID string) (string, error) {
	if jobID == "" {
		return "", nil
	}
	s, err := c.rdb.Get(ctx, jobStatusKeyPrefix+jobID).Result()
	if err == redis.Nil {
		return "unknown", nil
	}
	if err != nil {
		return "", err
	}
	return s, nil
}

// In-flight jobs. Dequeue pops the job off the list, so once processing starts
// Redis holds no record of it beyond a status string keyed by job id. If the
// process dies mid-job (OOM kill, container restart, hard panic) there is
// nothing left to tell the app the upload died, and the file row keeps whatever
// progress percentage it last received forever.
//
// MarkInFlight stores the whole job under a key the next startup can find. The
// TTL is a backstop for a worker that is retired and never comes back; normal
// operation always clears the key.
const (
	jobInFlightKeyPrefix = "upload:job:inflight:"
	jobInFlightTTL       = 24 * time.Hour
)

func (c *Client) MarkInFlight(ctx context.Context, job *Job) error {
	if job == nil || job.ID == "" {
		return nil
	}
	b, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, jobInFlightKeyPrefix+job.ID, b, jobInFlightTTL).Err()
}

func (c *Client) ClearInFlight(ctx context.Context, jobID string) error {
	if jobID == "" {
		return nil
	}
	return c.rdb.Del(ctx, jobInFlightKeyPrefix+jobID).Err()
}

// OrphanedJobs returns every job still marked in-flight. Call it at startup
// only: a live worker's current job is in this set too, so sweeping at any
// other time would fail a job that is happily running.
func (c *Client) OrphanedJobs(ctx context.Context) ([]*Job, error) {
	var out []*Job
	var cursor uint64
	for {
		keys, next, err := c.rdb.Scan(ctx, cursor, jobInFlightKeyPrefix+"*", 100).Result()
		if err != nil {
			return out, err
		}
		for _, k := range keys {
			raw, err := c.rdb.Get(ctx, k).Result()
			if err != nil {
				continue
			}
			var j Job
			if err := json.Unmarshal([]byte(raw), &j); err != nil {
				// Undecodable record is still a leak; drop it so it can't
				// accumulate forever.
				c.rdb.Del(ctx, k)
				continue
			}
			out = append(out, &j)
		}
		if next == 0 {
			break
		}
		cursor = next
	}
	return out, nil
}

func newJobID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b)
}
