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

type Job struct {
	ID               string       `json:"id"`
	UserID           string       `json:"user_id"`
	UploadID         string       `json:"upload_id"`
	FileName         string       `json:"file_name"`
	FileSize         int64        `json:"file_size"`
	TotalChunks      int          `json:"total_chunks"`
	Title            string       `json:"title,omitempty"`
	Description      string       `json:"description,omitempty"`
	UserCategories   []string     `json:"user_categories,omitempty"`
	UserTags         []string     `json:"user_tags,omitempty"`
	DefaultThumbnail string       `json:"default_thumbnail,omitempty"`
	FileSeriesID        string `json:"file_series_id,omitempty"`
	FileSeriesEpisodeID string `json:"file_series_episode_id,omitempty"`
	IsNewSeries         bool   `json:"is_new_series"`
	NewEpisodeName      string `json:"new_episode_name,omitempty"`
	ParentEpisodeID     string `json:"parent_episode_id,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
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

func (c *Client) Enqueue(ctx context.Context, userID, uploadID, fileName string, fileSize int64, totalChunks int, title, description string, userCategories, userTags []string, defaultThumbnail string, fileSeriesID, fileSeriesEpisodeID string, isNewSeries bool, newEpisodeName, parentEpisodeID string) (string, error) {
	jobID := newJobID()
	job := Job{
		ID:               jobID,
		UserID:           userID,
		UploadID:         uploadID,
		FileName:         fileName,
		FileSize:         fileSize,
		TotalChunks:      totalChunks,
		Title:            title,
		Description:      description,
		UserCategories:   userCategories,
		UserTags:         userTags,
		DefaultThumbnail: defaultThumbnail,
		FileSeriesID:        fileSeriesID,
		FileSeriesEpisodeID: fileSeriesEpisodeID,
		IsNewSeries:         isNewSeries,
		NewEpisodeName:      newEpisodeName,
		ParentEpisodeID:     parentEpisodeID,
		CreatedAt:        time.Now().UTC(),
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

func newJobID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b)
}
