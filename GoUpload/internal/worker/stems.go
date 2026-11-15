package worker

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"time"

	"goupload/internal/upload"
	"goupload/lib/ffmpeg"
	"goupload/lib/queue"
	"goupload/lib/stems"
)

// Stem separation: once a video with music is published, the StemsAPI sidecar
// splits its audio into drums, bass, other and vocals in the background, and
// the visualizer's audio_stems.json is rewritten from those stems. Until then
// the instant full mix analysis written during the upload stands in, so
// nothing about this can hold up or fail an upload.

const (
	stemsMaxQueued   = 20
	stemsMaxAttempts = 3
	stemsIdlePoll    = 15 * time.Second
	stemsRetryWait   = 2 * time.Minute
	stemsGiveUpAfter = 24 * time.Hour
	stemsAudioName   = "stems.flac"
	stemsDocName     = "audio_stems.json"
	// Uploads longer than this keep the instant analysis; the sidecar caps
	// what it reads at the same length.
	stemsMaxSeconds = 1200
	// The music detector must hear at least this much music to queue a
	// separation for an upload it doesn't call music overall.
	stemsMinMusicSeconds = 10
)

type stemsOutcome int

const (
	stemsDone stemsOutcome = iota
	stemsLater
	stemsStopped
)

func (w *Worker) stemsEnabled() bool {
	return w.cfg.Stems.Enabled() && w.cfg.StemsDir != ""
}

// stemsDir is stems/<user>/<upload>, or "" when either id is unsafe.
func (w *Worker) stemsDir(userID, uploadID string) string {
	if !workerUserIDPattern.MatchString(userID) || !upload.ValidUploadID(uploadID) {
		return ""
	}
	return filepath.Join(w.cfg.StemsDir, userID, uploadID)
}

// enqueueStems saves the audio while the source still exists and queues it.
// Only tracks with music get separated: a talk has no drums worth the minutes.
func (w *Worker) enqueueStems(job *queue.Job, sourcePath, prefix string, duration float64, hasMusic bool) {
	if !w.stemsEnabled() || !hasMusic || duration <= 0 || duration > stemsMaxSeconds {
		return
	}
	dir := w.stemsDir(job.UserID, job.UploadID)
	if dir == "" || !captionPrefixRe.MatchString(prefix) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	queued, err := w.queue.StemsUploadIDs(ctx)
	cancel()
	if err != nil || queued[job.UploadID] {
		return
	}
	if len(queued) >= stemsMaxQueued {
		w.log.Infof("stems skipped job=%s upload=%s: %d already waiting", job.ID, job.UploadID, len(queued))
		return
	}
	if err := ffmpeg.ExtractStemsAudio(sourcePath, filepath.Join(dir, stemsAudioName), stemsMaxSeconds); err != nil {
		w.log.Infof("stems audio failed job=%s reason=%s", job.ID, err.Error())
		w.removeJobDir(dir)
		return
	}
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	err = w.queue.PushStemsJob(ctx, &queue.StemsJob{
		UploadID:  job.UploadID,
		UserID:    job.UserID,
		Prefix:    prefix,
		Duration:  duration,
		CreatedAt: time.Now().UTC(),
	})
	cancel()
	if err != nil {
		w.log.Errorf("stems enqueue failed job=%s err=%s", job.ID, err.Error())
		w.removeJobDir(dir)
		return
	}
	w.log.Infof("stems queued job=%s upload=%s duration=%.0fs", job.ID, job.UploadID, duration)
}

// nextStems works on the job at the front of the queue and says how long to
// wait before looking again.
func (w *Worker) nextStems(ctx context.Context) time.Duration {
	job, raw, err := w.queue.PeekStemsJob(ctx)
	if err != nil {
		if ctx.Err() == nil {
			w.log.Errorf("stems queue read failed: %s", err.Error())
		}
		return stemsIdlePoll
	}
	if raw == "" {
		return stemsIdlePoll
	}
	if job == nil {
		w.log.Errorf("stems dropped an unreadable job")
		_ = w.queue.RemoveStemsJob(ctx, raw)
		return 0
	}
	switch w.stemsJob(ctx, job) {
	case stemsDone:
		bg := context.Background()
		_ = w.queue.RemoveStemsJob(bg, raw)
		w.queue.ClearStemsAttempts(bg, job.UploadID)
		w.removeJobDir(w.stemsDir(job.UserID, job.UploadID))
		return 0
	case stemsLater:
		_ = w.queue.MoveStemsJobLast(context.Background(), raw)
		return stemsRetryWait
	default:
		return 0
	}
}

func (w *Worker) stemsJob(ctx context.Context, job *queue.StemsJob) stemsOutcome {
	dir := w.stemsDir(job.UserID, job.UploadID)
	if dir == "" || !captionPrefixRe.MatchString(job.Prefix) || !strings.HasSuffix(job.Prefix, "/"+job.UploadID+"/") {
		w.log.Errorf("stems dropped a malformed job upload=%q", job.UploadID)
		return stemsDone
	}
	if w.queue.IsCanceled(ctx, job.UploadID) {
		return stemsDone
	}
	if time.Since(job.CreatedAt) > stemsGiveUpAfter {
		w.log.Errorf("stems gave up upload=%s: waited too long", job.UploadID)
		return stemsDone
	}
	n, err := w.queue.StemsAttempt(ctx, job.UploadID)
	if err != nil {
		return stemsLater
	}
	if n > stemsMaxAttempts {
		w.log.Errorf("stems gave up upload=%s after %d attempts", job.UploadID, n-1)
		return stemsDone
	}

	audioSeconds := min(job.Duration, stemsMaxSeconds)
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(audioSeconds*6)*time.Second+15*time.Minute)
	started := time.Now()
	bands, err := w.cfg.Stems.Separate(runCtx, filepath.Join(dir, stemsAudioName))
	cancel()
	if ctx.Err() != nil {
		w.queue.UndoStemsAttempt(context.Background(), job.UploadID)
		return stemsStopped
	}
	if errors.Is(err, stems.ErrBusy) {
		w.queue.UndoStemsAttempt(context.Background(), job.UploadID)
		return stemsLater
	}
	if errors.Is(err, stems.ErrUnreachable) {
		w.queue.UndoStemsAttempt(context.Background(), job.UploadID)
		w.log.Infof("stems waiting upload=%s: %s, not counted as a try", job.UploadID, err.Error())
		return stemsLater
	}
	if err != nil {
		w.log.Errorf("stems failed upload=%s attempt=%d err=%s", job.UploadID, n, err.Error())
		return stemsLater
	}
	doc, err := ffmpeg.StemsDocFromSeparated(bands)
	if err != nil {
		w.log.Errorf("stems answer rejected upload=%s err=%s", job.UploadID, err.Error())
		return stemsLater
	}
	data, err := json.Marshal(doc)
	if err != nil {
		return stemsDone
	}
	if w.queue.IsCanceled(ctx, job.UploadID) {
		return stemsDone
	}
	key := job.Prefix + stemsDocName
	if err := w.cfg.R2.PutObject(ctx, key, data, contentTypeFor(key)); err != nil {
		w.log.Errorf("stems store failed upload=%s err=%s", job.UploadID, err.Error())
		return stemsLater
	}
	took := time.Since(started)
	w.log.Infof("stems published upload=%s events=%d audio=%.0fs took=%s speed=%.2fx",
		job.UploadID, len(doc.Events), audioSeconds, took.Round(time.Second), audioSeconds/took.Seconds())
	return stemsDone
}

// sweepStemsLeftovers removes stems folders no queued job owns any more.
func (w *Worker) sweepStemsLeftovers(maxAge time.Duration) int {
	return sweepJobDirs(w.cfg.StemsDir, w.queue.StemsUploadIDs, maxAge)
}
