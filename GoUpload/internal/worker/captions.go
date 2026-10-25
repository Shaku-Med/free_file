package worker

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"goupload/internal/upload"
	"goupload/lib/ffmpeg"
	"goupload/lib/queue"
	"goupload/lib/transcribe"
	"goupload/lib/webhook"
)

// Auto captions: once a video is fully processed its speech is transcribed by
// whisper.cpp in the background, one video at a time at the lowest CPU
// priority, and handed to the app as a caption track labelled auto generated.
// Nothing about it can hold up or fail an upload.

const (
	captionMaxQueued   = 50
	captionMaxAttempts = 3
	captionIdlePoll    = 15 * time.Second
	captionRetryWait   = 5 * time.Minute
	// A track the app still hasn't taken after this long is dropped.
	captionGiveUpAfter = 24 * time.Hour
	captionAudioName   = "audio.flac"
	captionVTTName     = "captions.vtt"
	captionLangName    = "language"
)

var (
	captionPrefixRe = regexp.MustCompile(`^\d{2}_\d{2}_\d{4}/[a-f0-9]{32}/$`)
	captionLangRe   = regexp.MustCompile(`^[a-z]{2,3}$`)
)

type captionOutcome int

const (
	captionDone captionOutcome = iota
	captionLater
	captionStopped
)

func (w *Worker) captionsEnabled() bool {
	return w.cfg.Transcriber != nil && w.cfg.CaptionsDir != ""
}

// captionDir is captions/<user>/<upload>, or "" when either id is unsafe.
func (w *Worker) captionDir(userID, uploadID string) string {
	if !workerUserIDPattern.MatchString(userID) || !upload.ValidUploadID(uploadID) {
		return ""
	}
	return filepath.Join(w.cfg.CaptionsDir, userID, uploadID)
}

func (w *Worker) removeCaptionDir(dir string) {
	if dir == "" {
		return
	}
	_ = os.RemoveAll(dir)
	// The user folder only goes once it's empty: other uploads may be waiting.
	_ = os.Remove(filepath.Dir(dir))
}

// enqueueCaptions saves the audio while the source file still exists and queues
// it. Silent videos and very long ones are skipped.
func (w *Worker) enqueueCaptions(job *queue.Job, sourcePath, prefix string, duration float64, hasSound, song bool) {
	if !w.captionsEnabled() || !hasSound {
		return
	}
	if duration <= 0 || duration > w.cfg.Transcriber.MaxSeconds {
		w.log.Infof("auto captions skipped job=%s upload=%s duration=%.0fs", job.ID, job.UploadID, duration)
		return
	}
	dir := w.captionDir(job.UserID, job.UploadID)
	if dir == "" || !captionPrefixRe.MatchString(prefix) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	queued, err := w.queue.CaptionUploadIDs(ctx)
	cancel()
	// A job resumed after a restart reaches here a second time.
	if err != nil || queued[job.UploadID] {
		return
	}
	// Each waiting job keeps its audio on disk; a backlog this deep means the
	// box can't keep up, so new uploads go without rather than fill the disk.
	if len(queued) >= captionMaxQueued {
		w.log.Infof("auto captions skipped job=%s upload=%s: %d already waiting", job.ID, job.UploadID, len(queued))
		return
	}
	if err := ffmpeg.ExtractSpeechAudio(sourcePath, filepath.Join(dir, captionAudioName)); err != nil {
		w.log.Infof("auto captions audio failed job=%s reason=%s", job.ID, err.Error())
		w.removeCaptionDir(dir)
		return
	}
	// Its own deadline: extracting an hour of audio takes longer than the one above.
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	err = w.queue.PushCaptionJob(ctx, &queue.CaptionJob{
		UploadID:  job.UploadID,
		UserID:    job.UserID,
		Prefix:    prefix,
		Duration:  duration,
		CreatedAt: time.Now().UTC(),
		Song:      song,
	})
	cancel()
	if err != nil {
		w.log.Errorf("auto captions enqueue failed job=%s err=%s", job.ID, err.Error())
		w.removeCaptionDir(dir)
		return
	}
	w.log.Infof("auto captions queued job=%s upload=%s duration=%.0fs song=%v", job.ID, job.UploadID, duration, song)
}

// nextCaption works on the job at the front of the queue and says how long to
// wait before looking again.
func (w *Worker) nextCaption(ctx context.Context) time.Duration {
	job, raw, err := w.queue.PeekCaptionJob(ctx)
	if err != nil {
		if ctx.Err() == nil {
			w.log.Errorf("auto captions queue read failed: %s", err.Error())
		}
		return captionIdlePoll
	}
	if raw == "" {
		return captionIdlePoll
	}
	if job == nil {
		w.log.Errorf("auto captions dropped an unreadable job")
		_ = w.queue.RemoveCaptionJob(ctx, raw)
		return 0
	}
	switch w.captionJob(ctx, job) {
	case captionDone:
		bg := context.Background()
		_ = w.queue.RemoveCaptionJob(bg, raw)
		w.queue.ClearCaptionAttempts(bg, job.UploadID)
		w.removeCaptionDir(w.captionDir(job.UserID, job.UploadID))
		return 0
	case captionLater:
		_ = w.queue.MoveCaptionJobLast(context.Background(), raw)
		return captionRetryWait
	default:
		return 0
	}
}

func (w *Worker) captionJob(ctx context.Context, job *queue.CaptionJob) captionOutcome {
	dir := w.captionDir(job.UserID, job.UploadID)
	if dir == "" || !captionPrefixRe.MatchString(job.Prefix) || !strings.HasSuffix(job.Prefix, "/"+job.UploadID+"/") {
		w.log.Errorf("auto captions dropped a malformed job upload=%q", job.UploadID)
		return captionDone
	}
	if w.queue.IsCanceled(ctx, job.UploadID) {
		w.log.Infof("auto captions dropped upload=%s: the upload was removed", job.UploadID)
		return captionDone
	}

	lang, vtt := readCaptionResult(dir)
	if vtt == "" {
		if time.Since(job.CreatedAt) > captionGiveUpAfter {
			w.log.Errorf("auto captions gave up upload=%s: waited too long", job.UploadID)
			return captionDone
		}
		n, err := w.queue.CaptionAttempt(ctx, job.UploadID)
		if err != nil {
			return captionLater
		}
		if n > captionMaxAttempts {
			w.log.Errorf("auto captions gave up upload=%s after %d attempts", job.UploadID, n-1)
			return captionDone
		}

		timeout := time.Duration(job.Duration*6)*time.Second + 10*time.Minute
		runCtx, cancel := context.WithTimeout(ctx, timeout)
		started := time.Now()
		res, err := w.cfg.Transcriber.Run(runCtx, filepath.Join(dir, captionAudioName), dir, job.Song)
		cancel()
		if ctx.Err() != nil {
			w.queue.UndoCaptionAttempt(context.Background(), job.UploadID)
			return captionStopped
		}
		if err != nil {
			w.log.Errorf("auto captions failed upload=%s attempt=%d err=%s", job.UploadID, n, err.Error())
			return captionLater
		}
		took := time.Since(started)
		res.Music, res.Speech = w.captionSegments(ctx, job.UploadID, filepath.Join(dir, captionAudioName), job.Song)
		if ctx.Err() != nil {
			w.queue.UndoCaptionAttempt(context.Background(), job.UploadID)
			return captionStopped
		}

		var cues int
		lang, vtt, cues, err = transcribe.VTT(res)
		if errors.Is(err, transcribe.ErrNoSpeech) || errors.Is(err, transcribe.ErrNoLanguage) {
			w.log.Infof("auto captions skipped upload=%s: %s (lang=%q)", job.UploadID, err.Error(), res.Language)
			return captionDone
		}
		if err != nil {
			w.log.Infof("auto captions skipped upload=%s: %s", job.UploadID, err.Error())
			return captionDone
		}
		w.log.Infof("auto captions transcribed upload=%s lang=%s cues=%d music_spans=%d audio=%.0fs took=%s speed=%.2fx",
			job.UploadID, lang, cues, len(res.Music), job.Duration, took.Round(time.Second), job.Duration/took.Seconds())
		// Kept on disk so a failed hand off doesn't mean transcribing again.
		_ = os.WriteFile(filepath.Join(dir, captionVTTName), []byte(vtt), 0600)
		_ = os.WriteFile(filepath.Join(dir, captionLangName), []byte(lang), 0600)
	}

	if w.queue.IsCanceled(ctx, job.UploadID) {
		return captionDone
	}
	// Its own name, so it can never overwrite captions the owner uploaded.
	key := job.Prefix + "captions/auto-" + lang + ".vtt"
	if err := w.cfg.R2.PutObject(ctx, key, []byte(vtt), "text/vtt; charset=utf-8"); err != nil {
		w.log.Errorf("auto captions store failed upload=%s err=%s", job.UploadID, err.Error())
		return w.laterOrGiveUp(job, "")
	}
	err := webhook.SendAutoCaptions(ctx, webhook.AutoCaptions{
		UploadID: job.UploadID,
		UserID:   job.UserID,
		Language: lang,
		Path:     key,
	})
	switch {
	case err == nil:
		w.log.Infof("auto captions published upload=%s lang=%s", job.UploadID, lang)
		return captionDone
	case errors.Is(err, webhook.ErrCaptionsRejected):
		w.log.Infof("auto captions not used upload=%s: %s", job.UploadID, err.Error())
		w.deleteCaptionObject(key)
		return captionDone
	default:
		w.log.Infof("auto captions hand off failed upload=%s err=%s (will retry)", job.UploadID, err.Error())
		return w.laterOrGiveUp(job, key)
	}
}

// captionSegments asks the music detector where the caption audio is music,
// for [Music] lines, and where it's speech, so a line whisper is known to make
// up ("Thank you for watching!") can be dropped outside it. A song gets no
// speech: its singing counts as music. Without the detector the captions just
// go without either.
func (w *Worker) captionSegments(ctx context.Context, uploadID, audioPath string, song bool) (music, speech []transcribe.Span) {
	if w.cfg.Music == nil || !w.cfg.Music.Enabled() {
		return nil, nil
	}
	segs, err := w.cfg.Music.Segments(ctx, audioPath)
	if err != nil {
		w.log.Infof("auto captions without music labels upload=%s reason=%s", uploadID, err.Error())
		return nil, nil
	}
	for _, s := range segs {
		// Bounds also turn away NaN, which fails every comparison.
		if !(s.Start >= 0) || !(s.End > s.Start) || s.End > 24*3600 {
			continue
		}
		span := transcribe.Span{
			Start: time.Duration(s.Start * float64(time.Second)),
			End:   time.Duration(s.End * float64(time.Second)),
		}
		switch {
		case s.Label == "music":
			music = append(music, span)
		case s.Label == "speech" && !song:
			speech = append(speech, span)
		}
	}
	return music, speech
}

// laterOrGiveUp retries a finished track until captionGiveUpAfter, then drops
// it along with whatever was stored for it.
func (w *Worker) laterOrGiveUp(job *queue.CaptionJob, key string) captionOutcome {
	if time.Since(job.CreatedAt) <= captionGiveUpAfter {
		return captionLater
	}
	w.log.Errorf("auto captions gave up upload=%s: the app never took them", job.UploadID)
	if key != "" {
		w.deleteCaptionObject(key)
	}
	return captionDone
}

func (w *Worker) deleteCaptionObject(key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := w.cfg.R2.DeleteObject(ctx, key); err != nil {
		w.log.Errorf("auto captions cleanup failed key=%s err=%s", key, err.Error())
	}
}

func readCaptionResult(dir string) (lang, vtt string) {
	l, err := os.ReadFile(filepath.Join(dir, captionLangName))
	if err != nil {
		return "", ""
	}
	v, err := os.ReadFile(filepath.Join(dir, captionVTTName))
	if err != nil {
		return "", ""
	}
	lang = strings.TrimSpace(string(l))
	if !captionLangRe.MatchString(lang) {
		return "", ""
	}
	return lang, string(v)
}

// sweepCaptionLeftovers removes caption folders no queued job owns any more.
func (w *Worker) sweepCaptionLeftovers(maxAge time.Duration) int {
	if w.cfg.CaptionsDir == "" {
		return 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	owned, err := w.queue.CaptionUploadIDs(ctx)
	if err != nil {
		return 0
	}
	cutoff := time.Now().Add(-maxAge)
	removed := 0
	users, _ := os.ReadDir(w.cfg.CaptionsDir)
	for _, u := range users {
		if !u.IsDir() || !workerUserIDPattern.MatchString(u.Name()) {
			continue
		}
		userDir := filepath.Join(w.cfg.CaptionsDir, u.Name())
		entries, _ := os.ReadDir(userDir)
		for _, e := range entries {
			if !upload.ValidUploadID(e.Name()) || owned[e.Name()] {
				continue
			}
			info, ierr := e.Info()
			if ierr != nil || info.ModTime().After(cutoff) {
				continue
			}
			if os.RemoveAll(filepath.Join(userDir, e.Name())) == nil {
				removed++
			}
		}
		_ = os.Remove(userDir)
	}
	return removed
}
