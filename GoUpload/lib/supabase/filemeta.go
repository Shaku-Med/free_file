package supabase

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// FileCommentMeta is everything GoUpload needs to place a comment image under
// a video's folder when the browser only sends file_id (uuid).
type FileCommentMeta struct {
	UniqueID        string
	DateFolder      string
	IsAdult         bool
	CommentsEnabled bool
	Found           bool
}

func parseIsAdult(value json.RawMessage) bool {
	if len(value) == 0 || string(value) == "null" {
		return false
	}
	var b bool
	if err := json.Unmarshal(value, &b); err == nil {
		return b
	}
	var n int
	if err := json.Unmarshal(value, &n); err == nil {
		return n == 1
	}
	var s string
	if err := json.Unmarshal(value, &s); err == nil {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "true", "t", "1", "yes":
			return true
		default:
			return false
		}
	}
	return false
}

func dateFolderUTC(createdAt string) string {
	createdAt = strings.TrimSpace(createdAt)
	if createdAt == "" {
		return ""
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02 15:04:05-07",
	}
	var t time.Time
	var err error
	for _, layout := range layouts {
		t, err = time.Parse(layout, createdAt)
		if err == nil {
			break
		}
	}
	if err != nil {
		return ""
	}
	u := t.UTC()
	return fmt.Sprintf("%02d_%02d_%d", u.Day(), int(u.Month()), u.Year())
}

// FetchFileCommentMeta looks up a files row by primary key so browsers can upload
// comment images directly to GoUpload with only file_id + bearer (no app proxy).
func FetchFileCommentMeta(ctx context.Context, baseURL, serviceKey, fileID string) (FileCommentMeta, error) {
	if baseURL == "" || serviceKey == "" {
		return FileCommentMeta{}, fmt.Errorf("supabase not configured")
	}
	fileID = strings.TrimSpace(fileID)
	if _, err := uuid.Parse(fileID); err != nil {
		return FileCommentMeta{}, fmt.Errorf("invalid file id")
	}
	base := strings.TrimRight(baseURL, "/")
	reqURL := fmt.Sprintf(
		"%s/rest/v1/files?id=eq.%s&select=unique_id,created_at,is_adult,comments_enabled&limit=1",
		base, url.QueryEscape(fileID),
	)

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return FileCommentMeta{}, err
	}
	req.Header.Set("apikey", serviceKey)
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Accept", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return FileCommentMeta{}, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<10))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return FileCommentMeta{}, fmt.Errorf("supabase GET files meta %d", res.StatusCode)
	}
	var rows []struct {
		UniqueID        *string         `json:"unique_id"`
		CreatedAt       *string         `json:"created_at"`
		IsAdult         json.RawMessage `json:"is_adult"`
		CommentsEnabled *bool           `json:"comments_enabled"`
	}
	if err := json.Unmarshal(b, &rows); err != nil {
		return FileCommentMeta{}, err
	}
	if len(rows) == 0 {
		return FileCommentMeta{Found: false}, nil
	}
	out := FileCommentMeta{Found: true, CommentsEnabled: true}
	if rows[0].UniqueID != nil {
		out.UniqueID = strings.TrimSpace(*rows[0].UniqueID)
	}
	if rows[0].CreatedAt != nil {
		out.DateFolder = dateFolderUTC(*rows[0].CreatedAt)
	}
	out.IsAdult = parseIsAdult(rows[0].IsAdult)
	if rows[0].CommentsEnabled != nil {
		out.CommentsEnabled = *rows[0].CommentsEnabled
	}
	return out, nil
}
