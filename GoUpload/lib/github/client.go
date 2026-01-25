package github

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/go-github/v62/github"
	"golang.org/x/oauth2"
)

// DateFolder returns DD_MM_YYYY in UTC (matches app's getDateFolder).
func DateFolder(t time.Time) string {
	utc := t.UTC()
	d := utc.Day()
	m := int(utc.Month())
	y := utc.Year()
	return fmt.Sprintf("%02d_%02d_%04d", d, m, y)
}

// Config holds GitHub API settings. If Token is empty, uploads are skipped.
type Config struct {
	Token string
	Owner string
	Repo  string
}

// NewClient returns a GitHub client. If cfg.Token is empty, returns nil (callers must skip uploads).
func NewClient(cfg Config) *github.Client {
	if cfg.Token == "" {
		return nil
	}
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: cfg.Token})
	return github.NewClient(oauth2.NewClient(context.Background(), ts))
}

// CreateOrUpdateFile writes content to path, creating or updating via the Contents API.
// It GETs the file for SHA when updating, then PUTs with base64 body.
// The client can be nil (no-op). Message is used for the commit.
func CreateOrUpdateFile(ctx context.Context, client *github.Client, owner, repo, path string, content []byte, message string) error {
	if client == nil || owner == "" || repo == "" || path == "" {
		return nil
	}
	if message == "" {
		message = "Upload " + filepath.Base(path)
	}

	var sha *string
	fc, _, _, err := client.Repositories.GetContents(ctx, owner, repo, path, nil)
	if err != nil {
		var ge *github.ErrorResponse
		if errors.As(err, &ge) && ge.Response != nil && ge.Response.StatusCode == 404 {
			sha = nil
		} else {
			return fmt.Errorf("get contents %s: %w", path, err)
		}
	} else if fc != nil {
		s := fc.GetSHA()
		if s != "" {
			sha = &s
		}
	}

	opts := &github.RepositoryContentFileOptions{
		Message: &message,
		Content: content,
		SHA:     sha,
	}
	_, _, err = client.Repositories.CreateFile(ctx, owner, repo, path, opts)
	if err != nil {
		return fmt.Errorf("create/update %s: %w", path, err)
	}
	return nil
}

// UploadLocalFile reads the file from disk and calls CreateOrUpdateFile.
func UploadLocalFile(ctx context.Context, client *github.Client, owner, repo, path, localPath, message string) error {
	data, err := os.ReadFile(localPath)
	if err != nil {
		return fmt.Errorf("read %s: %w", localPath, err)
	}
	return CreateOrUpdateFile(ctx, client, owner, repo, path, data, message)
}

// UploadDir uploads all files under localDir to repo at prefix.
// Each file is uploaded to prefix/rel where rel is the path relative to localDir (using forward slashes).
// Skips directories. Names are normalized to forward slashes for GitHub paths.
func UploadDir(ctx context.Context, client *github.Client, owner, repo, prefix, localDir string, logf func(string, ...interface{})) error {
	if client == nil || localDir == "" {
		return nil
	}
	entries, err := os.ReadDir(localDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		full := filepath.Join(localDir, e.Name())
		if e.IsDir() {
			subPrefix := prefix + e.Name() + "/"
			if err := UploadDir(ctx, client, owner, repo, subPrefix, full, logf); err != nil {
				return err
			}
			continue
		}
		ghPath := prefix + e.Name()
		ghPath = filepath.ToSlash(ghPath)
		if err := UploadLocalFile(ctx, client, owner, repo, ghPath, full, "Upload "+e.Name()); err != nil {
			return err
		}
		if logf != nil {
			logf("github uploaded %s", ghPath)
		}
	}
	return nil
}

// UploadDirFlat uploads files only in localDir (no recursion), under prefix.
// Rel names are used as-is (e.g. thumb_0001.jpg).
func UploadDirFlat(ctx context.Context, client *github.Client, owner, repo, prefix, localDir string, logf func(string, ...interface{})) error {
	if client == nil || localDir == "" {
		return nil
	}
	entries, err := os.ReadDir(localDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		full := filepath.Join(localDir, e.Name())
		ghPath := strings.TrimSuffix(prefix, "/") + "/" + e.Name()
		ghPath = filepath.ToSlash(ghPath)
		if err := UploadLocalFile(ctx, client, owner, repo, ghPath, full, "Upload "+e.Name()); err != nil {
			return err
		}
		if logf != nil {
			logf("github uploaded %s", ghPath)
		}
	}
	return nil
}
