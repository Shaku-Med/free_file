package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

var reGitHubRepoName = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,100}$`)

// ValidGitHubRepoName matches GitHub repository name rules (conservative).
func ValidGitHubRepoName(s string) bool {
	return reGitHubRepoName.MatchString(s)
}

// FetchUserGithubRepo returns users.github_repo (trimmed) or "" if null/empty/not found.
func FetchUserGithubRepo(ctx context.Context, baseURL, serviceKey, userID string) (string, error) {
	if baseURL == "" || serviceKey == "" {
		return "", nil
	}
	if _, err := uuid.Parse(userID); err != nil {
		return "", fmt.Errorf("invalid user id: %w", err)
	}

	base := strings.TrimRight(baseURL, "/")
	reqURL := fmt.Sprintf("%s/rest/v1/users?id=eq.%s&select=github_repo", base, userID)

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("apikey", serviceKey)
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Accept", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("supabase GET users %d: %s", res.StatusCode, string(b))
	}

	var rows []struct {
		GithubRepo *string `json:"github_repo"`
	}
	if err := json.Unmarshal(b, &rows); err != nil {
		return "", err
	}
	if len(rows) == 0 || rows[0].GithubRepo == nil {
		return "", nil
	}
	return strings.TrimSpace(*rows[0].GithubRepo), nil
}

// SetUserGithubRepo PATCHes users.github_repo (service role).
func SetUserGithubRepo(ctx context.Context, baseURL, serviceKey, userID, repo string) error {
	if baseURL == "" || serviceKey == "" {
		return nil
	}
	if _, err := uuid.Parse(userID); err != nil {
		return fmt.Errorf("invalid user id: %w", err)
	}
	if !ValidGitHubRepoName(repo) {
		return fmt.Errorf("invalid github repo name")
	}

	base := strings.TrimRight(baseURL, "/")
	reqURL := fmt.Sprintf("%s/rest/v1/users?id=eq.%s", base, userID)

	body, err := json.Marshal(map[string]string{"github_repo": repo})
	if err != nil {
		return err
	}

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
	rb, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("supabase PATCH users %d: %s", res.StatusCode, string(rb))
	}
	return nil
}
