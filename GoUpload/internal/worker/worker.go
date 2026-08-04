package worker

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"goupload/internal/upload"
	"goupload/lib/assembler"
	"goupload/lib/colors"
	"goupload/lib/embed"
	"goupload/lib/ffmpeg"
	"goupload/lib/fingerprintdb"
	ghlib "goupload/lib/github"
	"goupload/lib/langdetect"
	"goupload/lib/logger"
	"goupload/lib/musicdetect"
	"goupload/lib/nsfw"
	"goupload/lib/queue"
	"goupload/lib/r2"
	"goupload/lib/security"
	"goupload/lib/webhook"

	"github.com/google/go-github/v62/github"
)

// workerUserIDPattern mirrors the HTTP ingress check (middleware.userIDPattern).
// Jobs are read back from Redis; if an attacker can write to the queue, these
// fields would otherwise flow straight into filesystem paths. We re-validate
// before any disk operation as defense-in-depth.
var workerUserIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

type Config struct {
	ChunksDir     string
	OutputDir     string
	TempDir       string
	HLSDir        string
	ThumbnailDir  string
	NSFWApiURL    string
	NSFWApiSecret string // X-Webhook-Secret for app /api/nsfw/detect; often UPLOAD_WEBHOOK_SECRET
	// GitHub: if GitHubClient is nil, uploads to GitHub are skipped.
	GitHubClient *github.Client
	GitHubOwner  string
	GitHubRepo   string
	// R2: when StorageBackend == "r2" and R2 is non-nil, new uploads go to
	// Cloudflare R2 instead of GitHub. Legacy files keep resolving via their
	// stored github_repo (dual-backend).
	R2             *r2.Client
	StorageBackend string
	// Embed: optional local embedding sidecar client for semantic search.
	Embed *embed.Client
	// Music: optional local MusicDetector sidecar; the source of truth for
	// is_music when set. Falls back to the stems heuristic when nil/unreachable.
	Music *musicdetect.Client
	// Fingerprints: on-VPS SQLite fingerprint store + matcher. When set, audio
	// duplicate detection runs locally and only the resulting link is sent to
	// the app (raw hashes never leave the box). Nil = fingerprinting disabled.
	Fingerprints *fingerprintdb.DB
}

type Worker struct {
	queue  *queue.Client
	log    *logger.Logger
	nsfw   *nsfw.Detector
	cfg    Config
	stopCh chan struct{}
	wg     sync.WaitGroup
}

func New(q *queue.Client, log *logger.Logger, cfg Config) *Worker {
	if cfg.TempDir == "" {
		cfg.TempDir = "upload/temp_processing"
	}
	if cfg.HLSDir == "" {
		cfg.HLSDir = "upload/hls"
	}
	if cfg.ThumbnailDir == "" {
		cfg.ThumbnailDir = "upload/thumbnails"
	}

	return &Worker{
		queue:  q,
		log:    log,
		nsfw:   nsfw.NewDetector(cfg.NSFWApiURL, cfg.NSFWApiSecret),
		cfg:    cfg,
		stopCh: make(chan struct{}),
	}
}

// useR2 reports whether new uploads for this worker target R2.
func (w *Worker) useR2() bool {
	return w.cfg.StorageBackend == "r2" && w.cfg.R2 != nil
}

func contentTypeFor(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".m3u8":
		return "application/vnd.apple.mpegurl"
	case ".ts":
		return "video/mp2t"
	case ".m4s", ".mp4", ".m4v":
		return "video/mp4"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".json":
		return "application/json"
	default:
		return "application/octet-stream"
	}
}

func (w *Worker) putLocalR2(ctx context.Context, key, localPath string) error {
	if w.cfg.R2 == nil {
		return fmt.Errorf("r2 client not configured")
	}
	data, err := os.ReadFile(localPath)
	if err != nil {
		return err
	}
	return w.cfg.R2.PutObject(ctx, key, data, contentTypeFor(key))
}

// uploadBatchR2 pushes a set of (RepoPath -> LocalPath) files to R2 using the
// same key layout GitHub used, with bounded concurrency. Returns the first
// error; the caller cleans up and fails the job on error.
func (w *Worker) uploadBatchR2(ctx context.Context, files []ghlib.BatchFile) error {
	if w.cfg.R2 == nil {
		return fmt.Errorf("r2 client not configured")
	}
	const concurrency = 6
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error
	for _, f := range files {
		wg.Add(1)
		go func(file ghlib.BatchFile) {
			defer wg.Done()
			// Catch any panic so a single file's blow-up cant take the worker
			// (and the whole process) down.
			defer func() {
				if r := recover(); r != nil {
					if w.log != nil {
						w.log.Errorf("uploadBatchR2 panic recovered file=%s err=%v", file.RepoPath, r)
					}
					mu.Lock()
					if firstErr == nil {
						firstErr = fmt.Errorf("upload panic: %v", r)
					}
					mu.Unlock()
				}
			}()
			sem <- struct{}{}
			defer func() { <-sem }()
			mu.Lock()
			stop := firstErr != nil
			mu.Unlock()
			if stop {
				return
			}
			data, err := os.ReadFile(file.LocalPath)
			if err == nil {
				err = w.cfg.R2.PutObject(ctx, file.RepoPath, data, contentTypeFor(file.RepoPath))
			}
			if err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
			}
		}(f)
	}
	wg.Wait()
	return firstErr
}

func (w *Worker) Start() {
	w.wg.Add(1)
	go w.run()
}

func (w *Worker) Stop() {
	close(w.stopCh)
	w.wg.Wait()
}

func (w *Worker) run() {
	defer w.wg.Done()
	w.log.Infof("worker started")
	var lastOrphanCleanup time.Time

	for {
		select {
		case <-w.stopCh:
			w.log.Infof("worker stopping")
			return
		default:
		}

		if lastOrphanCleanup.IsZero() || time.Since(lastOrphanCleanup) > 30*time.Minute {
			if n, err := upload.CleanupOrphanedChunks(w.cfg.ChunksDir, 24*time.Hour); err == nil && n > 0 {
				w.log.Infof("orphan chunk cleanup removed %d dirs", n)
			}
			lastOrphanCleanup = time.Now()
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		job, err := w.queue.Dequeue(ctx, 3*time.Second)
		cancel()

		if err != nil {
			w.log.Errorf("dequeue error: %s", err.Error())
			time.Sleep(time.Second)
			continue
		}

		if job == nil {
			continue
		}

		w.processJob(job)
	}
}

// decodeThumbnailBase64 decodes a client-provided thumbnail from the upload complete JSON.
// Browsers often omit base64 padding; data URLs or stray whitespace break StdEncoding.DecodeString.
func decodeThumbnailBase64(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, fmt.Errorf("empty thumbnail payload")
	}
	// Strip data:image/...;base64, prefix if present
	if idx := strings.Index(s, ","); idx >= 0 {
		prefix := strings.ToLower(s[:idx])
		if strings.Contains(prefix, "base64") {
			s = strings.TrimSpace(s[idx+1:])
		}
	}
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, " ", "")
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, fmt.Errorf("empty base64 after normalize")
	}
	// Pad to multiple of 4 (required by Go's decoder; some JS stacks omit '=')
	switch len(s) % 4 {
	case 1:
		return nil, fmt.Errorf("illegal base64 length")
	case 2:
		s += "=="
	case 3:
		s += "="
	}
	return base64.StdEncoding.DecodeString(s)
}

func (w *Worker) notifyRunningProgress(job *queue.Job, pct int) {
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	webhook.NotifyJobStatus(webhook.Payload{
		JobID:    job.ID,
		Status:   "running",
		UploadID: job.UploadID,
		UserID:   job.UserID,
		FileName: job.FileName,
		FileSize: job.FileSize,
		Progress: &pct,
	})
}

// embedForFile builds the document text (title + description + AI caption +
// categories + tags) and asks the local sidecar for a semantic-search vector.
// Soft-fail: nil on any error  search just stays lexical for this file.
func (w *Worker) embedForFile(job *queue.Job, categories, tags []string, metadata map[string]interface{}) []float32 {
	if w.cfg.Embed == nil || !w.cfg.Embed.Enabled() {
		return nil
	}
	var parts []string
	if t := strings.TrimSpace(job.Title); t != "" {
		parts = append(parts, t)
	}
	if d := strings.TrimSpace(job.Description); d != "" {
		parts = append(parts, d)
	}
	if metadata != nil {
		if v, ok := metadata["description"].(string); ok && strings.TrimSpace(v) != "" {
			parts = append(parts, strings.TrimSpace(v))
		}
	}
	if len(categories) > 0 {
		parts = append(parts, strings.Join(categories, " "))
	}
	if len(tags) > 0 {
		parts = append(parts, strings.Join(tags, " "))
	}
	if len(parts) == 0 {
		parts = append(parts, strings.TrimSpace(job.FileName))
	}
	text := strings.TrimSpace(strings.Join(parts, ". "))
	if text == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	vecs, err := w.cfg.Embed.Embed(ctx, []string{text}, "passage")
	if err != nil {
		w.log.Errorf("embed failed job=%s err=%s (continuing without vector)", job.ID, err.Error())
		return nil
	}
	if len(vecs) != 1 {
		return nil
	}
	return vecs[0]
}

// musicScoreThreshold: tag "Music" at/above this stems music score.
func musicScoreThreshold() float64 {
	if raw := os.Getenv("MUSIC_SCORE_THRESHOLD"); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v > 0 && v <= 1 {
			return v
		}
	}
	return 0.6
}

// musicProbeSeconds: how much audio to send the MusicDetector sidecar. Matches
// its own analysis cap so we don't ship more than it looks at.
func musicProbeSeconds() int {
	if raw := os.Getenv("MUSIC_PROBE_SECONDS"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			return v
		}
	}
	return 180
}

// heuristicIsMusic is the pre-sidecar signal, used as the fallback: a high stems
// beat-score, or any category that already mentions music (user/vision tags).
func heuristicIsMusic(stems *ffmpeg.AudioStemsResult, categories []string) bool {
	if stems != nil && stems.HasAudio && stems.MusicScore >= musicScoreThreshold() {
		return true
	}
	for _, c := range categories {
		if strings.Contains(strings.ToLower(c), "music") {
			return true
		}
	}
	return false
}

// classifyMusic asks the MusicDetector sidecar whether a file is actually music
// (by the music fraction of its audio). Soft-fail: ok=false on any problem so the
// caller falls back to the stems heuristic. A compact mono clip is sent, not the
// whole video.
func (w *Worker) classifyMusic(job *queue.Job, videoPath string) (isMusic bool, ratio float64, ok bool) {
	if w.cfg.Music == nil || !w.cfg.Music.Enabled() {
		return false, 0, false
	}
	// Probe clip goes to an ephemeral temp dir, NOT thumbDir (which is uploaded to
	// storage) or the upload volume. The whole dir is removed when we're done, so
	// nothing lingers on disk even if a step below fails.
	probeDir, err := os.MkdirTemp("", "musicprobe-")
	if err != nil {
		w.log.Infof("music probe tempdir failed job=%s reason=%s", job.ID, err.Error())
		return false, 0, false
	}
	defer os.RemoveAll(probeDir)

	clip, err := ffmpeg.ExtractAudioClip(videoPath, probeDir, musicProbeSeconds())
	if err != nil {
		w.log.Infof("music probe extract failed job=%s reason=%s", job.ID, err.Error())
		return false, 0, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	res, err := w.cfg.Music.Classify(ctx, clip)
	if err != nil || res == nil {
		w.log.Infof("music detector unavailable job=%s reason=%v (using heuristic)", job.ID, err)
		return false, 0, false
	}
	return res.IsMusic, res.MusicRatio, true
}

// visionFrameSamples is how many full-resolution frames are SafeSearch'd
// individually for the adult gate. Each is one Google Vision call, so this
// trades cost against coverage. Per-frame scoring avoids the mosaic dilution
// that weakens a grid-only check.
func visionFrameSamples() int {
	n := 6
	if raw := strings.TrimSpace(os.Getenv("VISION_FRAME_SAMPLES")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			n = v
		}
	}
	if n > 30 {
		n = 30
	}
	return n
}

// sampleFrameData picks up to n frames evenly spread across the video
// (first and last included), returning their raw bytes for per-frame scoring.
func sampleFrameData(thumbs []ffmpeg.Thumbnail, n int) [][]byte {
	count := len(thumbs)
	if count == 0 || n <= 0 {
		return nil
	}
	if n == 1 {
		return [][]byte{thumbs[count/2].Data}
	}
	if n >= count {
		out := make([][]byte, 0, count)
		for i := range thumbs {
			out = append(out, thumbs[i].Data)
		}
		return out
	}
	out := make([][]byte, 0, n)
	seen := make(map[int]struct{}, n)
	for i := 0; i < n; i++ {
		idx := i * (count - 1) / (n - 1)
		if _, dup := seen[idx]; dup {
			continue
		}
		seen[idx] = struct{}{}
		out = append(out, thumbs[idx].Data)
	}
	return out
}

func appendCategoryIfMissing(categories []string, category string) []string {
	for _, c := range categories {
		if strings.EqualFold(strings.TrimSpace(c), category) {
			return categories
		}
	}
	return append(categories, category)
}

// splitFingerprints flattens fingerprints into the parallel arrays the
// webhook payload carries (smaller JSON than an array of objects).
func splitFingerprints(fps []ffmpeg.AudioFingerprint) ([]uint32, []int32) {
	if len(fps) == 0 {
		return nil, nil
	}
	hashes := make([]uint32, len(fps))
	offsets := make([]int32, len(fps))
	for i, fp := range fps {
		hashes[i] = fp.Hash
		offsets[i] = fp.Offset
	}
	return hashes, offsets
}

// sharedRootDirs are directories that hold *every* job's working files
// failJob must NEVER RemoveAll one of these, or it'll wipe out siblings
// that are still mid-pipeline. We accept some empty leftover dirs in
// exchange for never trashing a healthy job.
var sharedRootDirs = map[string]struct{}{
	"assembled":       {},
	"hls":             {},
	"thumbnails":      {},
	"temp":            {},
	"temp_processing": {},
	"upload":          {},
}

func (w *Worker) failJob(job *queue.Job, reason string, cleanupPaths ...string) {
	w.log.Errorf("job FAILED job=%s reason=%s", job.ID, reason)
	for _, p := range cleanupPaths {
		if p == "" {
			continue
		}
		// Non-recursive first: works for empty parent dirs and is harmless
		// when the dir holds other jobs (errors out, no damage).
		if err := os.Remove(p); err == nil {
			continue
		}
		info, statErr := os.Stat(p)
		if statErr != nil {
			continue
		}
		if !info.IsDir() {
			_ = os.Remove(p)
			continue
		}
		// Refuse to recurse into any shared-root directory  that's the
		// regression that nuked sibling jobs' assembled files.
		if _, shared := sharedRootDirs[filepath.Base(p)]; shared {
			continue
		}
		_ = os.RemoveAll(p)
	}
	_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
	webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
}

func (w *Worker) processJob(job *queue.Job) {
	start := time.Now()
	_ = w.queue.SetJobStatus(context.Background(), job.ID, "running")
	w.notifyRunningProgress(job, 10)
	w.log.Infof("processing job=%s user=%s upload=%s file=%s", job.ID, job.UserID, job.UploadID, job.FileName)

	// Re-validate identifiers before they reach the filesystem. The HTTP ingress
	// already checks these, but jobs are read from Redis  if the queue is ever
	// writable by an attacker, an unvalidated FileName/UserID/UploadID with
	// "../" could let assembler.Assemble write outside the upload root.
	if !workerUserIDPattern.MatchString(job.UserID) || !upload.ValidUploadID(job.UploadID) {
		w.log.Errorf("rejecting job=%s: malformed user/upload id", job.ID)
		_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
		webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
		return
	}
	if _, err := security.SafeUploadFilename(job.FileName); err != nil {
		w.log.Errorf("rejecting job=%s: invalid filename: %v", job.ID, err)
		_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
		webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
		return
	}

	// Storage backend for THIS upload. github_repo is only meaningful for the
	// GitHub backend; R2 rows carry the bucket instead. Overflow jobs (extra
	// weekly allowance after the monthly quota filled) always take the GitHub
	// path regardless of the global backend.
	useR2 := w.useR2() && !job.Overflow
	storageBackend := "github"
	storageBucket := ""
	repoForPayload := w.cfg.GitHubRepo
	if useR2 {
		storageBackend = "r2"
		storageBucket = w.cfg.R2.Bucket()
		repoForPayload = ""
	}
	if job.Overflow && w.cfg.GitHubClient == nil {
		w.failJob(job, "overflow upload but github backend not configured")
		return
	}

	result, err := assembler.Assemble(assembler.Config{
		ChunksDir:   w.cfg.ChunksDir,
		OutputDir:   w.cfg.OutputDir,
		UserID:      job.UserID,
		UploadID:    job.UploadID,
		FileName:    job.FileName,
		TotalChunks: job.TotalChunks,
	})
	if err != nil {
		w.log.Errorf("assembly failed job=%s err=%s", job.ID, err.Error())
		_ = assembler.Cleanup(w.cfg.ChunksDir, job.UserID, job.UploadID)
		_ = os.Remove(filepath.Join(w.cfg.ChunksDir, job.UserID))
		_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
		webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
		return
	}
	w.log.Infof("assembled job=%s output=%s size=%d", job.ID, result.OutputPath, result.FileSize)
	w.notifyRunningProgress(job, 20)

	if result.FileSize == 0 {
		assembledDir := filepath.Dir(result.OutputPath)
		_ = assembler.Cleanup(w.cfg.ChunksDir, job.UserID, job.UploadID)
		w.failJob(job, "assembled file is empty (0 bytes)", result.OutputPath, assembledDir, filepath.Dir(assembledDir))
		return
	}

	if err := assembler.Cleanup(w.cfg.ChunksDir, job.UserID, job.UploadID); err != nil {
		w.log.Errorf("chunk cleanup failed job=%s err=%s", job.ID, err.Error())
	} else {
		_ = os.Remove(filepath.Join(w.cfg.ChunksDir, job.UserID))
	}

	if !isVideo(job.FileName) && !isImage(job.FileName) {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "unsupported file type: "+job.FileName, result.OutputPath, assembledDir, filepath.Dir(assembledDir))
		return
	}

	if !isVideo(job.FileName) {
		w.log.Infof("image file, validating job=%s", job.ID)

		if !validateImageFile(result.OutputPath) {
			assembledDir := filepath.Dir(result.OutputPath)
			w.failJob(job, "file is not a valid image (corrupt or wrong format)", result.OutputPath, assembledDir, filepath.Dir(assembledDir))
			return
		}
		w.log.Infof("image validated job=%s", job.ID)
		w.notifyRunningProgress(job, 40)

		dateFolder := ghlib.DateFolder(time.Now())
		// Never put the user-supplied filename in the storage key  it can
		// contain spaces / unicode / unsafe chars that break the path. Use a
		// fixed name; the original filename stays in the files.filename column.
		ghPath := dateFolder + "/" + job.UploadID + "/" + safeImageObjectName(job.FileName)
		var upErr error
		if useR2 {
			upErr = w.putLocalR2(context.Background(), ghPath, result.OutputPath)
		} else {
			upErr = ghlib.UploadLocalFile(context.Background(), w.cfg.GitHubClient, w.cfg.GitHubOwner, w.cfg.GitHubRepo, ghPath, result.OutputPath, "Upload "+job.FileName)
		}
		if upErr != nil {
			w.log.Errorf("storage upload failed backend=%s job=%s path=%s err=%s", storageBackend, job.ID, ghPath, upErr.Error())
			_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
			webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
			return
		}
		w.log.Infof("storage uploaded backend=%s job=%s path=%s", storageBackend, job.ID, ghPath)
		w.notifyRunningProgress(job, 65)

		isAdult := false
		contentFlag := "" // "adult" | "harmful"; drives the visibility lock
		var imgColors []string
		var categories, tags []string
		var metadata map[string]interface{}

		if isImage(job.FileName) && result.FileSize > 0 && result.FileSize <= 25*1024*1024 {
			data, rerr := os.ReadFile(result.OutputPath)
			if rerr != nil {
				assembledDir := filepath.Dir(result.OutputPath)
				w.failJob(job, "failed to read file for vision check: "+rerr.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir))
				return
			}

			visionRes, derr := w.nsfw.Detect(data)
			if derr != nil {
				assembledDir := filepath.Dir(result.OutputPath)
				w.failJob(job, "vision detection failed: "+derr.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir))
				return
			}
			isAdult = visionRes.IsNSFW
			contentFlag = visionRes.Category
			categories, tags, metadata = buildVisionData(&visionRes, job.Title, job.Description, job.UserCategories, job.UserTags)
			w.log.Infof("vision check job=%s adult=%v flag=%q reason=%q labels=%d", job.ID, isAdult, contentFlag, visionRes.FlagReason, len(visionRes.Labels))

			extracted, cerr := colors.ExtractDominant(data, 6)
			if cerr != nil {
				w.log.Errorf("color extraction failed job=%s err=%s (continuing)", job.ID, cerr.Error())
			} else {
				imgColors = extracted
				w.log.Infof("colors extracted job=%s count=%d", job.ID, len(imgColors))
			}
		}

		if err := os.Remove(result.OutputPath); err != nil {
			w.log.Errorf("cleanup assembled file failed job=%s err=%s", job.ID, err.Error())
		} else {
			w.log.Infof("cleanup assembled file job=%s path=%s", job.ID, result.OutputPath)
		}
		// Non-recursive removes: if the user has other concurrent uploads
		// in flight, these will fail silently and the orphan sweeper will
		// pick up the dir later. Using RemoveAll here used to wipe sibling
		// jobs' assembled files (concurrent worker pool regression).
		assembledDir := filepath.Dir(result.OutputPath)
		_ = os.Remove(assembledDir)
		_ = os.Remove(filepath.Dir(assembledDir))

		w.notifyRunningProgress(job, 92)
		_ = w.queue.SetJobStatus(context.Background(), job.ID, "completed")
		webhook.NotifyJobStatus(webhook.Payload{
			JobID:    job.ID,
			Status:   "completed",
			UploadID: job.UploadID,
			UserID:   job.UserID,
			FileName: job.FileName,
			// Actual stored bytes (assembled file). For images this matches
			// the source closely; we still send the post-processing number so
			// the ledger reflects R2 reality, not the declared size.
			FileSize:            result.FileSize,
			Endpoint:            ghPath,
			IsAdult:             &isAdult,
			ContentFlag:         contentFlag,
			Colors:              imgColors,
			Categories:          categories,
			Tags:                tags,
			Metadata:            metadata,
			FileSeriesID:        job.FileSeriesID,
			FileSeriesEpisodeID: job.FileSeriesEpisodeID,
			IsNewSeries:         job.IsNewSeries,
			NewEpisodeName:      job.NewEpisodeName,
			ParentEpisodeID:     job.ParentEpisodeID,
			GitHubRepo:          repoForPayload,
			StorageBackend:      storageBackend,
			StorageBucket:       storageBucket,
			Overflow:            job.Overflow,
			Embedding:           w.embedForFile(job, categories, tags, metadata),
			// Detected from the uploader's own words only - the AI caption is
			// always English and would mislabel non-English uploads.
			ContentLanguage: langdetect.Detect(job.Title, job.Description),
		})
		w.log.Infof("job complete job=%s duration=%s", job.ID, time.Since(start))
		return
	}

	thumbDir := filepath.Join(w.cfg.ThumbnailDir, job.UserID, job.UploadID)
	thumbResult, err := ffmpeg.ExtractThumbnails(result.OutputPath, thumbDir)
	if err != nil {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "thumbnail extraction failed (broken video): "+err.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), thumbDir, filepath.Dir(thumbDir))
		return
	}
	w.log.Infof("extracted %d thumbnails job=%s duration=%.2fs", len(thumbResult.Thumbnails), job.ID, thumbResult.Duration)
	w.notifyRunningProgress(job, 35)

	previewPath, metaPath, perr := ffmpeg.BuildThumbnailPreview(thumbDir, thumbResult)
	if perr != nil {
		w.log.Errorf("thumbnail preview failed job=%s err=%s", job.ID, perr.Error())
	} else {
		w.log.Infof("thumbnail_preview job=%s preview=%s meta=%s", job.ID, previewPath, metaPath)
	}

	// Best effort: a missing hover preview must not fail the upload.
	hoverPreviewOK := false
	if hoverPath, herr := ffmpeg.BuildHoverPreview(result.OutputPath, thumbDir, thumbResult.Duration); herr != nil {
		w.log.Errorf("hover preview failed job=%s err=%s", job.ID, herr.Error())
	} else {
		hoverPreviewOK = true
		w.log.Infof("hover_preview job=%s path=%s", job.ID, hoverPath)
	}

	// One full-quality grid replaces the per-frame thumb_*.jpg files. On
	// success the individual frames are dropped so they are neither uploaded
	// nor listed; cells map back to timestamps via thumbnail_grid.json.
	gridOK := false
	if gridPath, gridMetaPath, gerr := ffmpeg.BuildThumbnailGrid(thumbDir, thumbResult); gerr != nil {
		w.log.Errorf("thumbnail grid failed job=%s err=%s", job.ID, gerr.Error())
	} else {
		gridOK = true
		ffmpeg.CleanupThumbnails(thumbResult.Thumbnails)
		w.log.Infof("thumbnail_grid job=%s grid=%s meta=%s", job.ID, gridPath, gridMetaPath)
	}

	// ExtractWaveform always writes a file now  peaks if extraction
	// succeeded, zeros otherwise (silent/no-audio videos). werr is purely
	// informational; the file ships either way.
	waveformResult, werr := ffmpeg.ExtractWaveform(result.OutputPath, thumbDir)
	hasAudio := false
	if waveformResult != nil {
		hasAudio = waveformResult.HasAudio
	}
	if werr != nil {
		w.log.Infof("waveform fallback (flat) job=%s reason=%s has_audio=%v", job.ID, werr.Error(), hasAudio)
	} else if waveformResult != nil {
		w.log.Infof("waveform job=%s path=%s has_audio=%v", job.ID, waveformResult.Path, hasAudio)
	}

	// Audio stems (visualizer) + fingerprints (duplicate detection) off ONE
	// PCM decode. Soft-fail like the waveform: the stems file lands in
	// thumbDir so the early thumbnail batch ships it; fingerprints ride the
	// completion webhook.
	stemsResult, audioFingerprints, serr := ffmpeg.ExtractAudioStemsAndFingerprints(result.OutputPath, thumbDir)
	if serr != nil {
		w.log.Infof("audio stems skipped job=%s reason=%s", job.ID, serr.Error())
	} else if stemsResult != nil {
		w.log.Infof("audio stems job=%s events=%d has_audio=%v fingerprints=%d",
			job.ID, stemsResult.EventCount, stemsResult.HasAudio, len(audioFingerprints))
	}
	fpHashes, fpOffsets := splitFingerprints(audioFingerprints)

	if verr := ffmpeg.ValidateVideo(result.OutputPath); verr != nil {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "broken video file: "+verr.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), thumbDir, filepath.Dir(thumbDir))
		return
	}
	w.log.Infof("video validated job=%s", job.ID)

	videoInfo, probeErr := ffmpeg.ProbeVideo(result.OutputPath)
	if probeErr != nil {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "cannot read video metadata: "+probeErr.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), thumbDir, filepath.Dir(thumbDir))
		return
	}
	w.log.Infof("probe job=%s %dx%d aspect=%s codec=%s fps=%.2f audio=%s/%dHz/%dch",
		job.ID, videoInfo.Width, videoInfo.Height, videoInfo.AspectRatio,
		videoInfo.Codec, videoInfo.Fps, videoInfo.AudioCodec,
		videoInfo.AudioSampleRate, videoInfo.AudioChannels)

	w.notifyRunningProgress(job, 42)

	// ── Early upload: push thumbnails + waveform to GitHub right away ──
	dateFolder := ghlib.DateFolder(time.Now())
	ghPrefix := dateFolder + "/" + job.UploadID + "/"
	var thumbnailPaths []string
	var videoDuration float64
	defaultThumbPath := ""

	if thumbResult != nil {
		videoDuration = thumbResult.Duration

		// Decode user-chosen default thumbnail before early upload so it's included
		if job.DefaultThumbnail != "" {
			thumbData, derr := decodeThumbnailBase64(job.DefaultThumbnail)
			if derr != nil {
				w.log.Errorf("failed to decode default thumbnail job=%s err=%s", job.ID, derr.Error())
			} else if len(thumbData) == 0 {
				w.log.Errorf("default thumbnail decoded to empty job=%s", job.ID)
			} else {
				dtPath := filepath.Join(thumbDir, "default_thumbnail.jpg")
				if werr := os.WriteFile(dtPath, thumbData, 0644); werr != nil {
					w.log.Errorf("failed to write default thumbnail job=%s err=%s", job.ID, werr.Error())
				} else {
					w.log.Infof("default thumbnail saved job=%s path=%s bytes=%d", job.ID, dtPath, len(thumbData))
					defaultThumbPath = "default_thumbnail.jpg"
				}
			}

		}

		// Auto-pick the middle frame when there is no usable cover. This sits
		// OUTSIDE the block above on purpose: it used to be nested inside
		// `if job.DefaultThumbnail != ""`, so a video uploaded WITHOUT a chosen
		// cover fell through and got no default_thumbnail.jpg at all.
		if defaultThumbPath == "" && len(thumbResult.Thumbnails) > 0 {
			mid := thumbResult.Thumbnails[len(thumbResult.Thumbnails)/2].Data
			if len(mid) > 0 {
				dtPath := filepath.Join(thumbDir, "default_thumbnail.jpg")
				if werr := os.WriteFile(dtPath, mid, 0644); werr != nil {
					w.log.Errorf("auto default thumbnail write failed job=%s err=%s", job.ID, werr.Error())
				} else {
					defaultThumbPath = "default_thumbnail.jpg"
					w.log.Infof("auto default thumbnail (middle frame) job=%s bytes=%d", job.ID, len(mid))
				}
			}
		}

		thumbFiles, cerr := ghlib.CollectDirFlat(thumbDir, ghPrefix)
		if cerr != nil {
			w.log.Errorf("collect thumbnail files (early) failed job=%s err=%s", job.ID, cerr.Error())
		} else if len(thumbFiles) > 0 {
			var thErr error
			if useR2 {
				thErr = w.uploadBatchR2(context.Background(), thumbFiles)
			} else {
				ghBranch := os.Getenv("GITHUB_BRANCH")
				if ghBranch == "" {
					ghBranch = "main"
				}
				thErr = ghlib.BatchCommit(context.Background(), w.cfg.GitHubClient, w.cfg.GitHubOwner, w.cfg.GitHubRepo, ghBranch, "Thumbnails "+job.UploadID, thumbFiles, 4, w.log.Infof)
			}
			if thErr != nil {
				w.log.Errorf("thumbnail upload failed backend=%s job=%s err=%s", storageBackend, job.ID, thErr.Error())
			} else {
				w.log.Infof("thumbnails uploaded early backend=%s job=%s files=%d", storageBackend, job.ID, len(thumbFiles))
			}
		}

		if defaultThumbPath != "" {
			thumbnailPaths = append(thumbnailPaths, ghPrefix+defaultThumbPath)
		}
		if gridOK {
			thumbnailPaths = append(thumbnailPaths, ghPrefix+"thumbnail_grid.jpg")
			thumbnailPaths = append(thumbnailPaths, ghPrefix+"thumbnail_grid.json")
		} else {
			// Grid build failed: fall back to listing the individual frames.
			for i := range thumbResult.Thumbnails {
				thumbnailPaths = append(thumbnailPaths, ghPrefix+filepath.Base(thumbResult.Thumbnails[i].Path))
			}
		}
		thumbnailPaths = append(thumbnailPaths, ghPrefix+"thumbnail_preview.jpg")
		thumbnailPaths = append(thumbnailPaths, ghPrefix+"thumbnail_preview.json")

		defaultThumbGH := ""
		previewGH := ""
		if hoverPreviewOK {
			previewGH = ghPrefix + ffmpeg.HoverPreviewName
		}
		if defaultThumbPath != "" {
			defaultThumbGH = ghPrefix + defaultThumbPath
		}
		pct := 40
		webhook.NotifyJobStatus(webhook.Payload{
			JobID:            job.ID,
			Status:           "running",
			UploadID:         job.UploadID,
			UserID:           job.UserID,
			FileName:         job.FileName,
			FileSize:         job.FileSize,
			Progress:         &pct,
			Thumbnails:       thumbnailPaths,
			DefaultThumbnail: defaultThumbGH,
			PreviewEndpoint:  previewGH,
			Duration:         videoDuration,
			IsReel:           resolveReel(job.ReelMode, videoDuration, videoInfo.Width, videoInfo.Height),
		})
		w.log.Infof("thumbnails available early job=%s paths=%d", job.ID, len(thumbnailPaths))
	}

	isAdult := false
	contentFlag := "" // "adult" | "harmful"; drives the visibility lock
	var vidColors []string
	var categories, tags []string
	var metadata map[string]interface{}

	var loudnessInfo *ffmpeg.LoudnessInfo
	loudnessInfo, err = ffmpeg.ProbeLoudness(result.OutputPath)
	if err != nil {
		w.log.Errorf("loudness analysis failed job=%s err=%s (continuing)", job.ID, err.Error())
	} else {
		w.log.Infof("loudness job=%s integrated=%.1f LUFS peak=%.1f dBTP range=%.1f LU",
			job.ID, loudnessInfo.IntegratedLoudness, loudnessInfo.TruePeak, loudnessInfo.LoudnessRange)
	}

	if thumbResult != nil && len(thumbResult.Thumbnails) > 0 {
		count := len(thumbResult.Thumbnails)
		// Adult gate: SafeSearch several full-resolution frames individually,
		// evenly spread across the video. Per-frame scoring is undiluted (unlike
		// a grid), so this is what actually catches an isolated explicit frame.
		subset := sampleFrameData(thumbResult.Thumbnails, visionFrameSamples())
		// A frame grid holds EVERY sampled frame in one image, so the vision pass
		// covers the whole video, not just the 3 full-size frames above. Prefer
		// the full-quality thumbnail_grid (sharper cells = better adult
		// detection); fall back to the lighter preview sprite when the grid is
		// missing or over the vision API size cap.
		var gridData []byte
		gridCandidates := make([]string, 0, 2)
		if gridOK {
			gridCandidates = append(gridCandidates, filepath.Join(thumbDir, "thumbnail_grid.jpg"))
		}
		if previewPath != "" {
			gridCandidates = append(gridCandidates, previewPath)
		}
		for _, p := range gridCandidates {
			data, gerr := os.ReadFile(p)
			if gerr != nil {
				w.log.Errorf("read vision grid %s failed job=%s err=%s", filepath.Base(p), job.ID, gerr.Error())
				continue
			}
			if len(data) > 0 && len(data) <= maxVisionGridBytes {
				gridData = data
				break
			}
		}
		w.log.Infof("vision sampling %d of %d thumbnails (grid=%v) job=%s", len(subset), count, len(gridData) > 0, job.ID)

		var visionResult *nsfw.Result
		isAdult, visionResult, err = w.nsfw.DetectBatchWithGrid(gridData, subset)
		if err != nil {
			assembledDir := filepath.Dir(result.OutputPath)
			w.failJob(job, "vision detection failed: "+err.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), thumbDir, filepath.Dir(thumbDir))
			return
		}
		if visionResult != nil {
			contentFlag = visionResult.Category
		}
		w.log.Infof("vision check job=%s adult=%v flag=%q (checked %d frames + grid=%v)", job.ID, isAdult, contentFlag, len(subset), len(gridData) > 0)
		if visionResult != nil {
			categories, tags, metadata = buildVisionData(visionResult, job.Title, job.Description, job.UserCategories, job.UserTags)
		}

		var colorSample [][]byte
		colorStep := 1
		if len(thumbResult.Thumbnails) > 5 {
			colorStep = len(thumbResult.Thumbnails) / 5
		}
		for i := 0; i < len(thumbResult.Thumbnails) && len(colorSample) < 5; i += colorStep {
			colorSample = append(colorSample, thumbResult.Thumbnails[i].Data)
		}
		vidColors = colors.ExtractFromMultiple(colorSample, 6)
		w.log.Infof("colors extracted job=%s count=%d", job.ID, len(vidColors))
	}
	w.notifyRunningProgress(job, 55)

	if metadata == nil {
		metadata = make(map[string]interface{})
	}

	// musicScore (stems beat-regularity) is recorded as metadata regardless; it's
	// the fallback signal when the MusicDetector sidecar is off or unreachable.
	if stemsResult != nil && stemsResult.HasAudio {
		metadata["musicScore"] = stemsResult.MusicScore
	}

	// is_music: the MusicDetector sidecar is the source of truth when configured
	// and the file has audio. It gates on the music FRACTION of the track, so
	// clips with only background music under speech are not flagged. Falls back to
	// the stems beat-score + category heuristic when the sidecar is off or
	// unreachable; files with no audio are never music.
	isMusic := false
	if stemsResult != nil && stemsResult.HasAudio {
		if dm, ratio, ok := w.classifyMusic(job, result.OutputPath); ok {
			isMusic = dm
			metadata["musicRatio"] = ratio
			w.log.Infof("music detector job=%s is_music=%v ratio=%.2f", job.ID, dm, ratio)
		} else {
			isMusic = heuristicIsMusic(stemsResult, categories)
		}
	}

	if isMusic {
		categories = appendCategoryIfMissing(categories, "Music")
	} else {
		// Audio fingerprinting (original-sound detection) is music-only, so
		// non-music files send no prints  keeps the index music-only and cuts
		// false matches on talking-head videos.
		fpHashes, fpOffsets = nil, nil
	}

	// Reel status is needed both for the fingerprint matcher (reels can link
	// to an original but never become one) and the payload below. videoInfo
	// can be nil for audio-only music, so read dimensions defensively.
	var vidW, vidH int
	if videoInfo != nil {
		vidW, vidH = videoInfo.Width, videoInfo.Height
	}
	isReel := resolveReel(job.ReelMode, videoDuration, vidW, vidH)
	isReelBool := isReel != nil && *isReel

	// Match fingerprints locally (SQLite on the VPS). The raw hashes never
	// leave the box; only the resulting original link goes to the app.
	var fpProcessed bool
	var originalUniqueID string
	if w.cfg.Fingerprints != nil && len(fpHashes) > 0 && len(fpHashes) == len(fpOffsets) {
		fpProcessed = true
		res, ferr := w.cfg.Fingerprints.Register(
			context.Background(), job.UploadID, isReelBool, fpHashes, fpOffsets, fingerprintdb.DefaultMinVotes,
		)
		if ferr != nil {
			// Non-fatal: never block an upload on dedupe. Leave the link
			// untouched (fpProcessed=false) rather than clearing it on error.
			w.log.Errorf("fingerprint register job=%s err=%s", job.ID, ferr.Error())
			fpProcessed = false
		} else if res.Matched {
			originalUniqueID = res.OriginalUniqueID
			w.log.Infof("audio matched job=%s upload=%s original=%s votes=%d",
				job.ID, job.UploadID, res.OriginalUniqueID, res.Votes)
		}
	}

	// Embedded song tags (genre / artist / title / album) read by the probe.
	// Genre becomes a CATEGORY so it feeds search + the Mix generator (which
	// scores candidates on shared categories); the rest is kept under
	// metadata["music"] for display and auto playlist titles.
	if videoInfo != nil {
		music := map[string]interface{}{}
		if g := strings.TrimSpace(videoInfo.Genre); g != "" {
			categories = appendCategoryIfMissing(categories, g)
			music["genre"] = g
		}
		if a := strings.TrimSpace(videoInfo.Artist); a != "" {
			music["artist"] = a
		}
		if t := strings.TrimSpace(videoInfo.Title); t != "" {
			music["title"] = t
		}
		if al := strings.TrimSpace(videoInfo.Album); al != "" {
			music["album"] = al
		}
		if len(music) > 0 {
			metadata["music"] = music
		}
	}

	if videoInfo != nil {
		metadata["video"] = map[string]interface{}{
			"width":        videoInfo.Width,
			"height":       videoInfo.Height,
			"aspect_ratio": videoInfo.AspectRatio,
			"codec":        videoInfo.Codec,
			"fps":          videoInfo.Fps,
			"bitrate":      videoInfo.Bitrate,
		}
		metadata["audio"] = map[string]interface{}{
			"codec":       videoInfo.AudioCodec,
			"bitrate":     videoInfo.AudioBitrate,
			"sample_rate": videoInfo.AudioSampleRate,
			"channels":    videoInfo.AudioChannels,
			// has_audio combines the probe (is there an audio stream at all)
			// with the waveform analysis (is there any non-trivial amplitude).
			// The client uses this to grey out the volume button on silent
			// videos  both "video shot with mic muted" and "stock footage
			// with no audio track" land here.
			"has_audio": hasAudio && videoInfo.AudioCodec != "",
		}
	}
	if loudnessInfo != nil {
		metadata["loudness"] = map[string]interface{}{
			"integrated_lufs": loudnessInfo.IntegratedLoudness,
			"true_peak_dbtp":  loudnessInfo.TruePeak,
			"range_lu":        loudnessInfo.LoudnessRange,
		}
	}

	hlsDir := filepath.Join(w.cfg.HLSDir, job.UserID, job.UploadID)
	w.notifyRunningProgress(job, 58)
	hlsAll, err := ffmpeg.ConvertToHLSAllQualities(result.OutputPath, hlsDir, ffmpeg.HLSOptions{
		// 6s segments (down from 10): the player must fetch a whole segment
		// before it can start, so shorter segments mean a faster first frame —
		// the biggest win for slow connections. Apple's recommended default.
		SegmentTime: 6,
		IsReel:      isReelBool,
	})
	if err != nil {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "hls conversion failed: "+err.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), hlsDir, filepath.Dir(hlsDir), thumbDir, filepath.Dir(thumbDir))
		return
	} else {
		tierNames := make([]string, len(hlsAll.Tiers))
		for i, t := range hlsAll.Tiers {
			tierNames[i] = fmt.Sprintf("%s(%d segs)", t.TierName, len(t.SegmentFiles))
		}
		w.log.Infof("hls job=%s tiers=[%s]", job.ID, strings.Join(tierNames, ", "))
	}
	w.notifyRunningProgress(job, 78)

	videoEndpoint := ""
	var batchFiles []ghlib.BatchFile

	if hlsAll != nil {
		hlsFiles, cerr := ghlib.CollectDir(hlsDir, ghPrefix)
		if cerr != nil {
			w.failJob(job, "collect hls files: "+cerr.Error(), result.OutputPath, filepath.Dir(result.OutputPath), filepath.Dir(filepath.Dir(result.OutputPath)), hlsDir, filepath.Dir(hlsDir), thumbDir, filepath.Dir(thumbDir))
			return
		}
		batchFiles = append(batchFiles, hlsFiles...)
		videoEndpoint = dateFolder + "/" + job.UploadID + "/master.m3u8"
		w.log.Infof("collected %d hls files job=%s", len(hlsFiles), job.ID)
	}

	if len(batchFiles) > 0 {
		w.notifyRunningProgress(job, 85)
		var buErr error
		if useR2 {
			buErr = w.uploadBatchR2(context.Background(), batchFiles)
		} else {
			ghBranch := os.Getenv("GITHUB_BRANCH")
			if ghBranch == "" {
				ghBranch = "main"
			}
			buErr = ghlib.BatchCommit(context.Background(), w.cfg.GitHubClient, w.cfg.GitHubOwner, w.cfg.GitHubRepo, ghBranch, "Upload "+job.UploadID, batchFiles, 4, w.log.Infof)
		}
		if buErr != nil {
			w.log.Errorf("storage batch upload failed backend=%s job=%s files=%d err=%s", storageBackend, job.ID, len(batchFiles), buErr.Error())
			_ = os.RemoveAll(hlsDir)
			_ = os.Remove(filepath.Dir(hlsDir))
			_ = os.RemoveAll(thumbDir)
			_ = os.Remove(filepath.Dir(thumbDir))
			_ = os.Remove(result.OutputPath)
			// Non-recursive  see comment in image success path.
			_ = os.Remove(filepath.Dir(result.OutputPath))
			_ = os.Remove(filepath.Dir(filepath.Dir(result.OutputPath)))
			_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
			webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
			return
		}
		w.log.Infof("storage batch uploaded backend=%s job=%s files=%d", storageBackend, job.ID, len(batchFiles))
	}

	// Measure the ACTUAL post-processing bytes BEFORE cleanup. HLS ladder
	// (360p/480p/720p/1080p) + segments + manifests + thumbnails are the real
	// storage cost; the declared source size we got at /start is unrelated.
	// Falls back to job.FileSize if the walk somehow returns 0.
	processedBytes := dirSizeBytes(hlsDir) + dirSizeBytes(thumbDir)
	if processedBytes <= 0 {
		processedBytes = job.FileSize
	}
	w.log.Infof("post-processing size job=%s source=%d processed=%d ratio=%.2fx",
		job.ID, job.FileSize, processedBytes,
		func() float64 {
			if job.FileSize == 0 {
				return 0
			}
			return float64(processedBytes) / float64(job.FileSize)
		}())

	// Cleanup local HLS + thumbnail dirs
	_ = os.RemoveAll(hlsDir)
	_ = os.Remove(filepath.Dir(hlsDir))
	_ = os.Remove(w.cfg.HLSDir)
	_ = os.RemoveAll(thumbDir)
	_ = os.Remove(filepath.Dir(thumbDir))
	_ = os.Remove(w.cfg.ThumbnailDir)

	// Cleanup: remove assembled file, then non-recursive parent removes.
	// Never RemoveAll the user dir here  sibling jobs may have their own
	// assembled files in it.
	if err := os.Remove(result.OutputPath); err != nil {
		w.log.Errorf("cleanup assembled file failed job=%s err=%s", job.ID, err.Error())
	} else {
		w.log.Infof("cleanup assembled file job=%s path=%s", job.ID, result.OutputPath)
	}
	assembledDir := filepath.Dir(result.OutputPath)
	_ = os.Remove(assembledDir)
	_ = os.Remove(filepath.Dir(assembledDir))

	// Build default thumbnail GitHub path
	defaultThumbGH := ""
	if defaultThumbPath != "" {
		defaultThumbGH = ghPrefix + defaultThumbPath
	}
	previewGH := ""
	if hoverPreviewOK {
		previewGH = ghPrefix + ffmpeg.HoverPreviewName
	}

	w.notifyRunningProgress(job, 95)
	_ = w.queue.SetJobStatus(context.Background(), job.ID, "completed")
	webhook.NotifyJobStatus(webhook.Payload{
		JobID:    job.ID,
		Status:   "completed",
		UploadID: job.UploadID,
		UserID:   job.UserID,
		FileName: job.FileName,
		// Actual stored bytes (HLS ladder + thumbnails) measured before
		// cleanup, NOT the declared source size  the user is billed on what
		// lives in R2, which can be 1.5-2x the source for low-bitrate phone
		// videos.
		FileSize:            processedBytes,
		Endpoint:            videoEndpoint,
		Thumbnails:          thumbnailPaths,
		Duration:            videoDuration,
		IsReel:              isReel,
		IsAdult:             &isAdult,
		ContentFlag:         contentFlag,
		Colors:              vidColors,
		Categories:          categories,
		Tags:                tags,
		Metadata:            metadata,
		DefaultThumbnail:    defaultThumbGH,
		PreviewEndpoint:     previewGH,
		FileSeriesID:        job.FileSeriesID,
		FileSeriesEpisodeID: job.FileSeriesEpisodeID,
		IsNewSeries:         job.IsNewSeries,
		NewEpisodeName:      job.NewEpisodeName,
		ParentEpisodeID:     job.ParentEpisodeID,
		GitHubRepo:          repoForPayload,
		StorageBackend:      storageBackend,
		StorageBucket:       storageBucket,
		Overflow:            job.Overflow,
		Embedding:           w.embedForFile(job, categories, tags, metadata),
		IsMusic:             isMusic,
		FpProcessed:         fpProcessed,
		OriginalUniqueID:    originalUniqueID,
		// Uploader's own words only - the AI caption is always English.
		ContentLanguage: langdetect.Detect(job.Title, job.Description),
	})
	w.log.Infof("job complete job=%s user=%s upload=%s duration=%s thumbnails=%d colors=%d tags=%d overflow=%v fingerprints=%d", job.ID, job.UserID, job.UploadID, time.Since(start), len(thumbnailPaths), len(vidColors), len(tags), job.Overflow, len(fpHashes))
}

// reelAspectMatch is true for portrait ~9:16 (typical Reels / Shorts / TikTok).
func reelAspectMatch(width, height int) bool {
	if width <= 0 || height <= 0 {
		return false
	}
	if height <= width {
		return false
	}
	r := float64(width) / float64(height)
	const lo, hi = 0.45, 0.68
	return r >= lo && r <= hi
}

// reelMaxSeconds is the hard ceiling for reel duration. Anything longer
// can never be a reel regardless of what the uploader chose. Mirrors the
// 3-minute limit documented in the upload UI.
const reelMaxSeconds = 180

// resolveReel decides the final is_reel flag from (a) the user's chosen
// reelMode and (b) the inferred video shape. Anything over reelMaxSeconds
// is hard-denied  even an explicit "yes" and the auto portrait heuristic.
//
//	"no"   → always false
//	"yes"  → true (duration already known to be under the cap)
//	"auto" → existing heuristic (short OR portrait-9:16)
func resolveReel(reelMode string, seconds float64, width, height int) *bool {
	hasDur := seconds > 0
	hasWH := width > 0 && height > 0
	if !hasDur && !hasWH {
		return nil
	}
	if hasDur && seconds > reelMaxSeconds {
		f := false
		return &f
	}
	switch reelMode {
	case "no":
		f := false
		return &f
	case "yes":
		t := true
		return &t
	}
	// Auto-detect: short clip OR portrait aspect.
	if (hasDur && seconds < 120) || reelAspectMatch(width, height) {
		t := true
		return &t
	}
	f := false
	return &f
}

func isVideo(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v":
		return true
	}
	return false
}

// dirSizeBytes sums the bytes of every regular file under dir. Used to bill
// the user for the ACTUAL post-processing footprint (HLS ladder + thumbnails)
// instead of the declared source size. Returns 0 on any walk error  the
// caller falls back to the declared size in that case.
func dirSizeBytes(dir string) int64 {
	if dir == "" {
		return 0
	}
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		total += info.Size()
		return nil
	})
	return total
}

// safeImageObjectName returns a fixed storage name ("image" + a known-good
// extension) so the user's original filename never lands in the object key.
func safeImageObjectName(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp":
	default:
		ext = ".jpg"
	}
	return "image" + ext
}

func isImage(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp":
		return true
	}
	return false
}

func validateImageFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	header := make([]byte, 16)
	n, err := f.Read(header)
	if err != nil || n < 4 {
		return false
	}

	if header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF {
		return true
	}
	if header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47 {
		return true
	}
	if header[0] == 0x47 && header[1] == 0x49 && header[2] == 0x46 {
		return true
	}
	if n >= 12 && header[0] == 0x52 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x46 &&
		header[8] == 0x57 && header[9] == 0x45 && header[10] == 0x42 && header[11] == 0x50 {
		return true
	}
	if header[0] == 0x42 && header[1] == 0x4D {
		return true
	}

	return false
}

// maxVisionGridBytes caps the preview grid sent to the vision API; the API's
// JSON body limit must hold the ~1.33x base64 inflation.
const maxVisionGridBytes = 6 * 1024 * 1024

var categoryKeywords = map[string][]string{
	"Gaming":        {"game", "gaming", "gameplay", "playthrough", "walkthrough", "fortnite", "minecraft", "valorant", "roblox", "gta", "cod", "apex", "league", "overwatch", "fps", "rpg", "mmorpg", "esports", "speedrun", "stream", "twitch"},
	"Music":         {"music", "song", "beat", "remix", "cover", "acoustic", "instrumental", "rap", "hiphop", "hip-hop", "r&b", "pop", "rock", "edm", "lofi", "lo-fi", "playlist", "album", "lyric", "vocals", "dj", "producer"},
	"Entertainment": {"funny", "comedy", "meme", "skit", "prank", "reaction", "challenge", "vlog", "storytime", "drama", "celebrity", "trending", "viral"},
	"Education":     {"tutorial", "how to", "howto", "learn", "course", "lecture", "explained", "guide", "lesson", "study", "tips", "educational", "science", "history", "math"},
	"Technology":    {"tech", "review", "unboxing", "setup", "pc", "phone", "laptop", "software", "hardware", "coding", "programming", "ai", "robot", "gadget", "apple", "android", "windows"},
	"Sports":        {"sport", "football", "soccer", "basketball", "baseball", "tennis", "boxing", "mma", "ufc", "nba", "nfl", "fifa", "workout", "gym", "fitness", "training", "highlights"},
	"News":          {"news", "breaking", "politics", "election", "update", "report", "journalist", "interview", "debate", "analysis"},
	"Lifestyle":     {"lifestyle", "fashion", "beauty", "makeup", "skincare", "outfit", "haul", "cooking", "recipe", "food", "travel", "vacation", "diy", "home", "decor", "asmr"},
	"Anime":         {"anime", "manga", "otaku", "weeb", "naruto", "one piece", "dragon ball", "attack on titan", "demon slayer", "jujutsu", "cosplay", "waifu"},
	"Film":          {"movie", "film", "trailer", "cinema", "review", "scene", "actor", "director", "netflix", "series", "tv show", "episode", "season"},
	"Automotive":    {"car", "cars", "drift", "racing", "engine", "turbo", "exhaust", "jdm", "supercar", "hypercar", "motorcycle", "bike", "mod", "wrap"},
	"Art":           {"art", "drawing", "painting", "sketch", "digital art", "illustration", "timelapse", "creative", "design", "animation", "3d", "blender"},
	"Nature":        {"nature", "animal", "wildlife", "ocean", "mountain", "forest", "sunset", "landscape", "garden", "pet", "dog", "cat"},
}

// canonicalCategory maps a free-form category string to the canonical
// taxonomy (the keys of categoryKeywords). Clean, stable category names are
// what user_interest_scores keys on  random Vision labels like "Sky" or
// "Smile" used to leak in here and fragment the feed personalization.
func canonicalCategory(s string) (string, bool) {
	needle := strings.ToLower(strings.TrimSpace(s))
	if needle == "" {
		return "", false
	}
	for category := range categoryKeywords {
		if strings.ToLower(category) == needle {
			return category, true
		}
	}
	return "", false
}

func buildVisionData(vr *nsfw.Result, title, description string, userCategories, userTags []string) (categories []string, tags []string, metadata map[string]interface{}) {
	metadata = make(map[string]interface{})
	seen := make(map[string]bool)

	for _, uc := range userCategories {
		uc = strings.TrimSpace(uc)
		if uc != "" && !seen[uc] {
			categories = append(categories, uc)
			seen[uc] = true
		}
	}
	for _, ut := range userTags {
		ut = strings.TrimSpace(ut)
		if ut != "" && !seen[ut] {
			tags = append(tags, ut)
			seen[ut] = true
		}
	}

	if vr.Description != "" {
		metadata["description"] = vr.Description
	}

	if vr.SafeSearch != nil {
		metadata["safeSearch"] = map[string]string{
			"adult":    vr.SafeSearch.Adult,
			"violence": vr.SafeSearch.Violence,
			"racy":     vr.SafeSearch.Racy,
			"spoof":    vr.SafeSearch.Spoof,
			"medical":  vr.SafeSearch.Medical,
		}
	}

	// VLM-suggested categories: only accept canonical taxonomy names so the
	// feed's interest profiles stay on a small, consistent category set.
	hadCanonicalCategory := false
	for _, sc := range vr.SuggestedCategories {
		if canon, ok := canonicalCategory(sc); ok && !seen[canon] {
			categories = append(categories, canon)
			seen[canon] = true
			hadCanonicalCategory = true
		}
	}
	for _, st := range vr.SuggestedTags {
		st = strings.TrimSpace(st)
		if st != "" && !seen[st] {
			tags = append(tags, st)
			seen[st] = true
		}
	}

	var labelNames []string
	if len(vr.Labels) > 0 {
		var rawLabels []map[string]interface{}
		// Only confident labels become visible tags: at 0.50 Vision's coin-flip
		// guesses ("Surfboard", "Dancing mouse") were landing as hashtags on
		// unrelated videos. All labels still go to metadata/search regardless.
		const labelTagMinScore = 0.75
		const labelTagMax = 8
		labelTags := 0
		for _, l := range vr.Labels {
			rawLabels = append(rawLabels, map[string]interface{}{
				"name":  l.Name,
				"score": l.Score,
			})
			labelNames = append(labelNames, strings.ToLower(l.Name))
			if l.Score >= labelTagMinScore && labelTags < labelTagMax && !seen[l.Name] {
				tags = append(tags, l.Name)
				seen[l.Name] = true
				labelTags++
			}
		}
		metadata["labels"] = rawLabels
		metadata["labelNames"] = labelNames
	}

	// Keyword-match the user's text AND the AI caption: the VLM often says
	// "a music video of ..." for untagged uploads  a free second witness.
	combined := strings.ToLower(title + " " + description + " " + vr.Description)
	var matchedCategories []string

	for category, keywords := range categoryKeywords {
		for _, kw := range keywords {
			if strings.Contains(combined, kw) {
				matchedCategories = append(matchedCategories, category)
				if !seen[category] {
					categories = append(categories, category)
					seen[category] = true
					hadCanonicalCategory = true
				}
				break
			}
		}
	}

	// Fallback: no canonical category from VLM, keywords, or the uploader
	// promote the strongest vision labels so the file isn't category-less.
	if !hadCanonicalCategory && len(categories) == 0 {
		promoted := 0
		for _, l := range vr.Labels {
			if l.Score >= 0.85 && !seen[l.Name] {
				categories = append(categories, l.Name)
				seen[l.Name] = true
				promoted++
				if promoted >= 3 {
					break
				}
			}
		}
	}

	if title != "" || description != "" {
		metadata["textAnalysis"] = map[string]interface{}{
			"title":             title,
			"description":       description,
			"matchedCategories": matchedCategories,
		}
	}
	if len(vr.SuggestedCategories) > 0 || len(vr.SuggestedTags) > 0 {
		metadata["visionSuggested"] = map[string]interface{}{
			"categories": vr.SuggestedCategories,
			"tags":       vr.SuggestedTags,
		}
	}

	return categories, tags, metadata
}
