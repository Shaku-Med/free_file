package supabase

import (
	"bytes"
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

func validBackend(b string) bool {
	return b == "github" || b == "r2"
}

// SetUserStorageBackend PATCHes users.storage_backend (service role).
func SetUserStorageBackend(ctx context.Context, baseURL, serviceKey, userID, backend string) error {
	if baseURL == "" || serviceKey == "" {
		return nil
	}
	if _, err := uuid.Parse(userID); err != nil {
		return fmt.Errorf("invalid user id: %w", err)
	}
	if !validBackend(backend) {
		return fmt.Errorf("invalid storage backend")
	}
	base := strings.TrimRight(baseURL, "/")
	reqURL := fmt.Sprintf("%s/rest/v1/users?id=eq.%s", base, userID)
	body, _ := json.Marshal(map[string]string{"storage_backend": backend})

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, reqURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", serviceKey)
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("supabase PATCH users backend %d: %s", res.StatusCode, string(rb))
	}
	return nil
}

// FetchFileStorageBackend returns files.storage_backend for a unique_id, or
// "github" when not found / unset (safe default).
func FetchFileStorageBackend(ctx context.Context, baseURL, serviceKey, uniqueID string) (string, error) {
	if baseURL == "" || serviceKey == "" {
		return "github", nil
	}
	uniqueID = strings.TrimSpace(uniqueID)
	if uniqueID == "" || len(uniqueID) > 128 {
		return "github", nil
	}
	base := strings.TrimRight(baseURL, "/")
	reqURL := fmt.Sprintf("%s/rest/v1/files?unique_id=eq.%s&select=storage_backend&limit=1", base, url.QueryEscape(uniqueID))

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "github", err
	}
	req.Header.Set("apikey", serviceKey)
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Accept", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "github", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 8<<10))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "github", fmt.Errorf("supabase GET files backend %d", res.StatusCode)
	}
	var rows []struct {
		StorageBackend *string `json:"storage_backend"`
	}
	if err := json.Unmarshal(b, &rows); err != nil {
		return "github", err
	}
	if len(rows) == 0 || rows[0].StorageBackend == nil {
		return "github", nil
	}
	v := strings.TrimSpace(*rows[0].StorageBackend)
	if !validBackend(v) {
		return "github", nil
	}
	return v, nil
}
