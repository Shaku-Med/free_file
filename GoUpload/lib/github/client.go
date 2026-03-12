package github

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/go-github/v62/github"
	"golang.org/x/oauth2"
)

func DateFolder(t time.Time) string {
	utc := t.UTC()
	d := utc.Day()
	m := int(utc.Month())
	y := utc.Year()
	return fmt.Sprintf("%02d_%02d_%04d", d, m, y)
}

type Config struct {
	Token string
	Owner string
	Repo  string
}

func NewClient(cfg Config) *github.Client {
	if cfg.Token == "" {
		return nil
	}
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: cfg.Token})
	return github.NewClient(oauth2.NewClient(context.Background(), ts))
}

// CreateOrUpdateFile writes a single file via the Contents API.
// Kept for single-file uploads (images). For bulk uploads use BatchCommit.
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

func UploadLocalFile(ctx context.Context, client *github.Client, owner, repo, path, localPath, message string) error {
	data, err := os.ReadFile(localPath)
	if err != nil {
		return fmt.Errorf("read %s: %w", localPath, err)
	}
	return CreateOrUpdateFile(ctx, client, owner, repo, path, data, message)
}

// --- Batch upload via Git Data API (blobs + tree + commit) ---

type BatchFile struct {
	RepoPath  string
	LocalPath string
}

func CollectDir(localDir, repoPrefix string) ([]BatchFile, error) {
	var files []BatchFile
	err := filepath.Walk(localDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(localDir, path)
		repoPath := repoPrefix + filepath.ToSlash(rel)
		files = append(files, BatchFile{RepoPath: repoPath, LocalPath: path})
		return nil
	})
	return files, err
}

func CollectDirFlat(localDir, repoPrefix string) ([]BatchFile, error) {
	entries, err := os.ReadDir(localDir)
	if err != nil {
		return nil, err
	}
	prefix := strings.TrimSuffix(repoPrefix, "/") + "/"
	var files []BatchFile
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		files = append(files, BatchFile{
			RepoPath:  prefix + e.Name(),
			LocalPath: filepath.Join(localDir, e.Name()),
		})
	}
	return files, nil
}

const maxBlobRetries = 6

// BatchCommit uploads files in a single Git commit using the Git Data API.
// Blob creation is parallelised with a global throttle to stay under
// GitHub's secondary rate limits (~5 req/s sustained).
func BatchCommit(ctx context.Context, client *github.Client, owner, repo, branch, message string, files []BatchFile, concurrency int, logf func(string, ...interface{})) error {
	if client == nil || len(files) == 0 {
		return nil
	}
	if branch == "" {
		branch = "main"
	}
	if concurrency <= 0 {
		concurrency = 4
	}
	if message == "" {
		message = fmt.Sprintf("Upload %d files", len(files))
	}
	if logf == nil {
		logf = func(string, ...interface{}) {}
	}

	logf("batch: %d files → %s/%s@%s (concurrency %d)", len(files), owner, repo, branch, concurrency)

	ref, _, err := client.Git.GetRef(ctx, owner, repo, "refs/heads/"+branch)
	if err != nil {
		return fmt.Errorf("get ref heads/%s: %w", branch, err)
	}
	baseCommitSHA := ref.GetObject().GetSHA()

	baseCommit, _, err := client.Git.GetCommit(ctx, owner, repo, baseCommitSHA)
	if err != nil {
		return fmt.Errorf("get base commit: %w", err)
	}
	baseTreeSHA := baseCommit.GetTree().GetSHA()
	logf("batch: base commit=%s tree=%s", short(baseCommitSHA), short(baseTreeSHA))

	// Global throttle: one token every 200ms → ~5 requests/sec across all goroutines.
	// This keeps us well under GitHub's secondary rate limit.
	throttle := make(chan struct{}, 1)
	stopThrottle := make(chan struct{})
	go func() {
		tick := time.NewTicker(200 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-stopThrottle:
				return
			case <-tick.C:
				select {
				case throttle <- struct{}{}:
				default:
				}
			}
		}
	}()

	type blobResult struct {
		sha string
		err error
	}
	results := make([]blobResult, len(files))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var done int64

	for i, f := range files {
		wg.Add(1)
		go func(idx int, file BatchFile) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			data, err := os.ReadFile(file.LocalPath)
			if err != nil {
				results[idx] = blobResult{err: fmt.Errorf("read %s: %w", file.LocalPath, err)}
				return
			}

			encoded := base64.StdEncoding.EncodeToString(data)
			encoding := "base64"

			var blob *github.Blob
			for attempt := 1; attempt <= maxBlobRetries; attempt++ {
				select {
				case <-throttle:
				case <-ctx.Done():
					results[idx] = blobResult{err: ctx.Err()}
					return
				}

				blob, _, err = client.Git.CreateBlob(ctx, owner, repo, &github.Blob{
					Content:  &encoded,
					Encoding: &encoding,
				})
				if err == nil {
					break
				}

				wait := rateLimitWait(err, attempt)
				if wait > 0 {
					logf("batch: rate-limited on blob %d, waiting %s (attempt %d/%d)", idx, wait, attempt, maxBlobRetries)
					time.Sleep(wait)
					continue
				}
				if attempt < maxBlobRetries {
					time.Sleep(time.Duration(attempt) * time.Second)
				}
			}
			if err != nil {
				results[idx] = blobResult{err: fmt.Errorf("blob %s: %w", file.RepoPath, err)}
				return
			}

			n := atomic.AddInt64(&done, 1)
			if n%50 == 0 || n == int64(len(files)) {
				logf("batch: blobs %d/%d", n, len(files))
			}
			results[idx] = blobResult{sha: blob.GetSHA()}
		}(i, f)
	}
	wg.Wait()
	close(stopThrottle)

	for _, r := range results {
		if r.err != nil {
			return r.err
		}
	}
	logf("batch: all %d blobs created", len(files))

	// Build tree entries from blob SHAs
	allEntries := make([]*github.TreeEntry, len(files))
	for i, f := range files {
		p := filepath.ToSlash(f.RepoPath)
		m := "100644"
		t := "blob"
		s := results[i].sha
		allEntries[i] = &github.TreeEntry{
			Path: &p,
			Mode: &m,
			Type: &t,
			SHA:  &s,
		}
	}

	// GitHub 502s on huge trees, so commit in chunks of <=150 entries.
	// Each chunk builds on the previous commit's tree.
	const treeChunkSize = 150
	currentTreeSHA := baseTreeSHA
	currentCommitSHA := baseCommitSHA

	for start := 0; start < len(allEntries); start += treeChunkSize {
		end := start + treeChunkSize
		if end > len(allEntries) {
			end = len(allEntries)
		}
		chunk := allEntries[start:end]
		chunkNum := (start / treeChunkSize) + 1
		totalChunks := (len(allEntries) + treeChunkSize - 1) / treeChunkSize

		tree, _, terr := client.Git.CreateTree(ctx, owner, repo, currentTreeSHA, chunk)
		if terr != nil {
			return fmt.Errorf("create tree chunk %d/%d (%d entries): %w", chunkNum, totalChunks, len(chunk), terr)
		}

		commitMsg := message
		if totalChunks > 1 {
			commitMsg = fmt.Sprintf("%s (%d/%d)", message, chunkNum, totalChunks)
		}
		commit, _, cerr := client.Git.CreateCommit(ctx, owner, repo, &github.Commit{
			Message: &commitMsg,
			Tree:    tree,
			Parents: []*github.Commit{{SHA: &currentCommitSHA}},
		}, nil)
		if cerr != nil {
			return fmt.Errorf("create commit chunk %d/%d: %w", chunkNum, totalChunks, cerr)
		}

		currentTreeSHA = tree.GetSHA()
		currentCommitSHA = commit.GetSHA()
		logf("batch: chunk %d/%d committed (%d files) → %s", chunkNum, totalChunks, len(chunk), short(currentCommitSHA))
	}

	ref.Object.SHA = &currentCommitSHA
	_, _, err = client.Git.UpdateRef(ctx, owner, repo, ref, false)
	if err != nil {
		return fmt.Errorf("update ref: %w", err)
	}
	logf("batch: pushed to %s (%s)", branch, short(currentCommitSHA))

	return nil
}

// rateLimitWait detects GitHub rate-limit errors and returns how long to wait.
// Returns 0 for non-rate-limit errors.
func rateLimitWait(err error, attempt int) time.Duration {
	var abuse *github.AbuseRateLimitError
	if errors.As(err, &abuse) {
		if abuse.RetryAfter != nil && *abuse.RetryAfter > 0 {
			return *abuse.RetryAfter + time.Second
		}
		return time.Duration(30*attempt) * time.Second
	}
	var rl *github.RateLimitError
	if errors.As(err, &rl) {
		wait := time.Until(rl.Rate.Reset.Time) + time.Second
		if wait < 5*time.Second {
			wait = 60 * time.Second
		}
		return wait
	}
	return 0
}

func short(sha string) string {
	if len(sha) > 8 {
		return sha[:8]
	}
	return sha
}
