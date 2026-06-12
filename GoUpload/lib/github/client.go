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

// singleFileGate serialises Contents-API writes per (owner/repo) so concurrent
// workers don't race each other into 409 conflicts. The Contents API checks
// the parent SHA at PUT time  if N goroutines GET the same parent then race
// to PUT, only one wins and the rest 409. Holding a per-repo mutex around
// the GET+PUT pair eliminates the race in-process; the retry loop below
// handles the cross-process case (another deploy pushing concurrently).
var (
	singleFileGateMu sync.Mutex
	singleFileGates  = map[string]*sync.Mutex{}
)

func gateFor(owner, repo string) *sync.Mutex {
	singleFileGateMu.Lock()
	defer singleFileGateMu.Unlock()
	key := owner + "/" + repo
	m, ok := singleFileGates[key]
	if !ok {
		m = &sync.Mutex{}
		singleFileGates[key] = m
	}
	return m
}

// isContentsConflict reports a 409 / "does not match" from the Contents API,
// which is what GitHub returns when our parent SHA is stale.
func isContentsConflict(err error) bool {
	var ge *github.ErrorResponse
	if !errors.As(err, &ge) || ge.Response == nil {
		return false
	}
	if ge.Response.StatusCode == 409 {
		return true
	}
	if ge.Response.StatusCode == 422 {
		// Some versions return 422 "sha does not match".
		if strings.Contains(strings.ToLower(ge.Message), "does not match") {
			return true
		}
	}
	return false
}

// CreateOrUpdateFile writes a single file via the Contents API.
// Kept for single-file uploads (images). For bulk uploads use BatchCommit.
//
// Concurrency: GitHub's Contents API does a parent-SHA check on every PUT,
// so N parallel workers writing distinct paths to the same repo can still
// collide on the branch's HEAD. We serialise per repo via singleFileGates
// and retry on 409 by re-fetching the latest blob SHA.
func CreateOrUpdateFile(ctx context.Context, client *github.Client, owner, repo, path string, content []byte, message string) error {
	if client == nil || owner == "" || repo == "" || path == "" {
		return nil
	}
	if message == "" {
		message = "Upload " + filepath.Base(path)
	}

	gate := gateFor(owner, repo)
	gate.Lock()
	defer gate.Unlock()

	const maxAttempts = 5
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
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
		if err == nil {
			return nil
		}
		lastErr = err

		// Retry only on parent-SHA conflicts; everything else is fatal.
		if !isContentsConflict(err) {
			return fmt.Errorf("create/update %s: %w", path, err)
		}

		// Tiny jittered backoff so we don't immediately re-race ourselves.
		backoff := time.Duration(200*attempt) * time.Millisecond
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return fmt.Errorf("create/update %s: exhausted retries: %w", path, lastErr)
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

	// GitHub 502s on huge trees, so commit in chunks of <=100 entries.
	// Reduced from 150 to 100 for better reliability on large uploads.
	// Each chunk builds on the previous commit's tree.
	const treeChunkSize = 100
	const maxTreeRetries = 4
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

		// Retry tree creation with exponential backoff
		var tree *github.Tree
		var terr error
		for attempt := 1; attempt <= maxTreeRetries; attempt++ {
			tree, _, terr = client.Git.CreateTree(ctx, owner, repo, currentTreeSHA, chunk)
			if terr == nil {
				break
			}
			wait := rateLimitWait(terr, attempt)
			if wait > 0 {
				logf("batch: rate-limited on tree chunk %d/%d, waiting %s (attempt %d/%d)", chunkNum, totalChunks, wait, attempt, maxTreeRetries)
				time.Sleep(wait)
				continue
			}
			// Exponential backoff for 502/500 errors
			if attempt < maxTreeRetries {
				backoff := time.Duration(attempt*attempt) * 2 * time.Second
				logf("batch: tree chunk %d/%d failed (attempt %d/%d): %v  retrying in %s", chunkNum, totalChunks, attempt, maxTreeRetries, terr, backoff)
				time.Sleep(backoff)
			}
		}
		if terr != nil {
			return fmt.Errorf("create tree chunk %d/%d (%d entries): %w", chunkNum, totalChunks, len(chunk), terr)
		}

		commitMsg := message
		if totalChunks > 1 {
			commitMsg = fmt.Sprintf("%s (%d/%d)", message, chunkNum, totalChunks)
		}

		// Retry commit creation with exponential backoff
		var commit *github.Commit
		var cerr error
		for attempt := 1; attempt <= maxTreeRetries; attempt++ {
			commit, _, cerr = client.Git.CreateCommit(ctx, owner, repo, &github.Commit{
				Message: &commitMsg,
				Tree:    tree,
				Parents: []*github.Commit{{SHA: &currentCommitSHA}},
			}, nil)
			if cerr == nil {
				break
			}
			wait := rateLimitWait(cerr, attempt)
			if wait > 0 {
				logf("batch: rate-limited on commit chunk %d/%d, waiting %s (attempt %d/%d)", chunkNum, totalChunks, wait, attempt, maxTreeRetries)
				time.Sleep(wait)
				continue
			}
			if attempt < maxTreeRetries {
				backoff := time.Duration(attempt*attempt) * 2 * time.Second
				logf("batch: commit chunk %d/%d failed (attempt %d/%d): %v  retrying in %s", chunkNum, totalChunks, attempt, maxTreeRetries, cerr, backoff)
				time.Sleep(backoff)
			}
		}
		if cerr != nil {
			return fmt.Errorf("create commit chunk %d/%d: %w", chunkNum, totalChunks, cerr)
		}

		currentTreeSHA = tree.GetSHA()
		currentCommitSHA = commit.GetSHA()
		logf("batch: chunk %d/%d committed (%d files) → %s", chunkNum, totalChunks, len(chunk), short(currentCommitSHA))

		// Pause between chunks to avoid secondary rate limits on large uploads
		if start+treeChunkSize < len(allEntries) {
			time.Sleep(500 * time.Millisecond)
		}
	}

	// Retry ref update  this is the final critical step
	var mergeFallbackTried bool
	for attempt := 1; attempt <= maxTreeRetries; attempt++ {
		ref.Object.SHA = &currentCommitSHA
		_, _, err = client.Git.UpdateRef(ctx, owner, repo, ref, false)
		if err == nil {
			break
		}
		// Long uploads often race another push to main: our commit's parent is stale → 422 not a fast-forward.
		// Merge our upload tip onto the current branch tip (GitHub creates a merge commit).
		if !mergeFallbackTried && isRefNotFastForward(err) {
			mergeFallbackTried = true
			logf("batch: branch %s moved during upload (not fast-forward); merging upload commit %s", branch, short(currentCommitSHA))
			base := branch
			head := currentCommitSHA
			mergeMsg := message
			if len(mergeMsg) > 500 {
				mergeMsg = mergeMsg[:500]
			}
			mergeMsg = mergeMsg + " [merge: concurrent update to " + branch + "]"
			_, _, merr := client.Repositories.Merge(ctx, owner, repo, &github.RepositoryMergeRequest{
				Base:          &base,
				Head:          &head,
				CommitMessage: &mergeMsg,
			})
			if merr == nil {
				err = nil
				break
			}
			logf("batch: merge fallback failed: %v (resolve conflicts on GitHub or retry upload)", merr)
		}
		wait := rateLimitWait(err, attempt)
		if wait > 0 {
			logf("batch: rate-limited on ref update, waiting %s (attempt %d/%d)", wait, attempt, maxTreeRetries)
			time.Sleep(wait)
			continue
		}
		if attempt < maxTreeRetries {
			backoff := time.Duration(attempt*attempt) * 2 * time.Second
			logf("batch: ref update failed (attempt %d/%d): %v  retrying in %s", attempt, maxTreeRetries, err, backoff)
			time.Sleep(backoff)
		}
	}
	if err != nil {
		return fmt.Errorf("update ref: %w", err)
	}
	logf("batch: pushed to %s (%s)", branch, short(currentCommitSHA))

	return nil
}

// DeleteFolder removes every blob under prefix in ONE commit via the Git
// Data API (a tree entry with a nil SHA deletes that path). Serialised per
// repo through the same gate the uploaders use; retried when the branch
// moves mid-flight. Returns how many blobs were deleted.
func DeleteFolder(ctx context.Context, client *github.Client, owner, repo, branch, prefix, message string) (int, error) {
	if client == nil || owner == "" || repo == "" || prefix == "" || !strings.HasSuffix(prefix, "/") {
		return 0, errors.New("github: invalid delete args")
	}
	if branch == "" {
		branch = "main"
	}
	if message == "" {
		message = "Remove " + strings.TrimSuffix(prefix, "/")
	}

	gate := gateFor(owner, repo)
	gate.Lock()
	defer gate.Unlock()

	const maxAttempts = 4
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		ref, _, err := client.Git.GetRef(ctx, owner, repo, "refs/heads/"+branch)
		if err != nil {
			return 0, fmt.Errorf("get ref heads/%s: %w", branch, err)
		}
		baseCommitSHA := ref.GetObject().GetSHA()
		baseCommit, _, err := client.Git.GetCommit(ctx, owner, repo, baseCommitSHA)
		if err != nil {
			return 0, fmt.Errorf("get base commit: %w", err)
		}
		baseTreeSHA := baseCommit.GetTree().GetSHA()

		tree, _, err := client.Git.GetTree(ctx, owner, repo, baseTreeSHA, true)
		if err != nil {
			return 0, fmt.Errorf("get tree: %w", err)
		}
		if tree.GetTruncated() {
			return 0, errors.New("github: tree truncated, cannot purge safely")
		}

		var entries []*github.TreeEntry
		for _, e := range tree.Entries {
			if e.GetType() != "blob" || !strings.HasPrefix(e.GetPath(), prefix) {
				continue
			}
			p := e.GetPath()
			m := "100644"
			t := "blob"
			// nil SHA + nil Content marshals as "sha": null = delete this path.
			entries = append(entries, &github.TreeEntry{Path: &p, Mode: &m, Type: &t})
		}
		if len(entries) == 0 {
			return 0, nil
		}

		newTree, _, err := client.Git.CreateTree(ctx, owner, repo, baseTreeSHA, entries)
		if err != nil {
			return 0, fmt.Errorf("create delete tree: %w", err)
		}
		commit, _, err := client.Git.CreateCommit(ctx, owner, repo, &github.Commit{
			Message: &message,
			Tree:    newTree,
			Parents: []*github.Commit{{SHA: &baseCommitSHA}},
		}, nil)
		if err != nil {
			return 0, fmt.Errorf("create delete commit: %w", err)
		}

		sha := commit.GetSHA()
		ref.Object.SHA = &sha
		_, _, err = client.Git.UpdateRef(ctx, owner, repo, ref, false)
		if err == nil {
			return len(entries), nil
		}
		lastErr = err
		// Branch advanced while we built the commit  re-read and retry.
		if !isRefNotFastForward(err) && !isContentsConflict(err) {
			return 0, fmt.Errorf("update ref: %w", err)
		}
		select {
		case <-time.After(time.Duration(300*attempt) * time.Millisecond):
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}
	return 0, fmt.Errorf("github: delete exhausted retries: %w", lastErr)
}

// isRefNotFastForward reports GitHub's 422 when HEAD advanced and a non-force ref update is rejected.
func isRefNotFastForward(err error) bool {
	var ge *github.ErrorResponse
	if !errors.As(err, &ge) || ge.Response == nil || ge.Response.StatusCode != 422 {
		return false
	}
	msg := strings.ToLower(ge.Message)
	if strings.Contains(msg, "fast forward") || strings.Contains(msg, "fast-forward") {
		return true
	}
	for _, e := range ge.Errors {
		if strings.Contains(strings.ToLower(e.Message), "fast forward") {
			return true
		}
	}
	return false
}

// rateLimitWait detects GitHub rate-limit and server errors, returning how long to wait.
// Returns 0 for non-retryable errors.
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
	// Retry on GitHub server errors (500, 502, 503) with exponential backoff
	var ge *github.ErrorResponse
	if errors.As(err, &ge) && ge.Response != nil {
		code := ge.Response.StatusCode
		if code == 500 || code == 502 || code == 503 {
			return time.Duration(attempt*attempt) * 3 * time.Second
		}
	}
	return 0
}

func short(sha string) string {
	if len(sha) > 8 {
		return sha[:8]
	}
	return sha
}
