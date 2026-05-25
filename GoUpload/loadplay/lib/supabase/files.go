package supabase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// FileMeta is everything LoadPlay needs to make an access decision for a
// single file. Kept tiny on purpose — the more columns we pull, the
// more pressure on the DB and the slower the cache fill.
type FileMeta struct {
	ID         string
	GithubRepo string
	OwnerID    string
	IsPublic   bool
	IsAdult    bool
	Exists     bool
}

// ErrNotFound is returned (and cached) when the row is missing. The
// caller can treat it as a 404 and remember it for a short window so
// scan attempts don't pound the DB.
var ErrNotFound = errors.New("file not found")

// Client is the minimum surface — base URL + service role key. Both
// from env, never hardcoded.
type Client struct {
	BaseURL    string
	ServiceKey string
	HTTPClient *http.Client
}

func New(baseURL, serviceKey string) *Client {
	return &Client{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		ServiceKey: serviceKey,
		HTTPClient: &http.Client{Timeout: 8 * time.Second},
	}
}

// GetFileMeta loads a file row by public `unique_id` (the value in URLs
// and playback tokens — NOT the internal UUID primary key). Service-role
// key only; never exposed to the browser.
func (c *Client) GetFileMeta(ctx context.Context, uniqueID string) (*FileMeta, error) {
	if c.BaseURL == "" || c.ServiceKey == "" {
		return nil, errors.New("supabase client not configured")
	}
	if !isValidUniqueID(uniqueID) {
		return nil, ErrNotFound
	}

	reqURL := fmt.Sprintf(
		"%s/rest/v1/files?unique_id=eq.%s&select=id,github_repo,owner_id,is_public,is_adult&limit=1",
		c.BaseURL, url.QueryEscape(uniqueID),
	)
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.ServiceKey)
	req.Header.Set("Authorization", "Bearer "+c.ServiceKey)
	req.Header.Set("Accept", "application/json")

	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase %d", res.StatusCode)
	}
	var rows []struct {
		ID         string  `json:"id"`
		GithubRepo *string `json:"github_repo"`
		OwnerID    *string `json:"owner_id"`
		IsPublic   *bool   `json:"is_public"`
		IsAdult    *bool   `json:"is_adult"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	r := rows[0]
	meta := &FileMeta{
		ID:     r.ID,
		Exists: true,
	}
	if r.GithubRepo != nil {
		meta.GithubRepo = strings.TrimSpace(*r.GithubRepo)
	}
	if r.OwnerID != nil {
		meta.OwnerID = *r.OwnerID
	}
	if r.IsPublic != nil {
		meta.IsPublic = *r.IsPublic
	}
	if r.IsAdult != nil {
		meta.IsAdult = *r.IsAdult
	}
	return meta, nil
}

func isValidUniqueID(s string) bool {
	if len(s) < 8 || len(s) > 128 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			continue
		default:
			return false
		}
	}
	return true
}
