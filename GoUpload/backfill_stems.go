package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"goupload/lib/env"
	"goupload/lib/ffmpeg"
	"goupload/lib/queue"
	"goupload/lib/r2"
)

// The stems backfill gives music videos published before the stems sidecar
// existed the same AI separation new uploads get. Their source files are gone,
// so it rebuilds the audio from the published HLS audio rendition and queues
// an ordinary stems job; the worker does the rest. It feeds the queue a few at
// a time so new uploads never wait behind it, and it resumes from its state
// file, so stopping it (or a deploy restarting the container) loses nothing.
//
//	docker exec -d goupload /app/goupload -backfill-stems
//	docker exec goupload /app/goupload -backfill-stems -dry-run

const (
	// Matches the worker: stems/<user>/<upload>/stems.flac, at most 20 minutes.
	backfillStemsDir    = "upload/stems"
	backfillMaxSeconds  = 1200
	backfillMaxSegments = 2000
	backfillMaxBytes    = 1 << 30
	backfillPageSize    = 500
)

var (
	backfillUploadRe   = regexp.MustCompile(`^[a-f0-9]{32}$`)
	backfillPrefixRe   = regexp.MustCompile(`^\d{2}_\d{2}_\d{4}/[a-f0-9]{32}/$`)
	backfillUserRe     = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	backfillPlaylistRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}/[A-Za-z0-9_-]{1,64}\.m3u8$`)
	backfillSegmentRe  = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,96}\.ts$`)
	backfillMediaURIRe = regexp.MustCompile(`URI="([^"]*)"`)
)

// stemsBackfillCutoff is when the stems sidecar went live: uploads since then
// were separated as they came in.
var stemsBackfillCutoff = time.Date(2026, 11, 15, 8, 23, 0, 0, time.UTC)

type backfillCandidate struct {
	UniqueID  string  `json:"unique_id"`
	OwnerID   string  `json:"owner_id"`
	Endpoint  string  `json:"endpoint"`
	Duration  float64 `json:"duration"`
	CreatedAt string  `json:"created_at"`
}

// prefix is the upload's storage folder, or "" when the row doesn't describe
// one the worker would accept.
func (c backfillCandidate) prefix() string {
	if !backfillUploadRe.MatchString(c.UniqueID) || !backfillUserRe.MatchString(c.OwnerID) {
		return ""
	}
	if !(c.Duration > 0 && c.Duration <= backfillMaxSeconds) {
		return ""
	}
	p := path.Dir(c.Endpoint) + "/"
	if !backfillPrefixRe.MatchString(p) || !strings.HasSuffix(p, "/"+c.UniqueID+"/") {
		return ""
	}
	return p
}

type stemsQueue interface {
	StemsUploadIDs(ctx context.Context) (map[string]bool, error)
	PushStemsJob(ctx context.Context, job *queue.StemsJob) error
}

type objectSigner interface {
	PresignGet(key string, ttl time.Duration) (string, error)
}

type stemsBackfill struct {
	sbURL, sbKey string
	store        objectSigner
	queue        stemsQueue
	http         *http.Client
	stemsDir     string
	workDir      string
	before       time.Time
	maxQueued    int
	limit        int
	dryRun       bool
	poll         time.Duration
	state        *backfillState
	log          *log.Logger
}

func runStemsBackfill(args []string) error {
	fs := flag.NewFlagSet("backfill-stems", flag.ContinueOnError)
	dryRun := fs.Bool("dry-run", false, "list what would be queued and change nothing")
	limit := fs.Int("limit", 0, "queue at most this many uploads (0 means all)")
	maxQueued := fs.Int("max-queued", 2, "only add a job while fewer than this many stems jobs wait")
	before := fs.String("before", stemsBackfillCutoff.Format(time.RFC3339), "only uploads created before this time")
	statePath := fs.String("state", "upload/stems-backfill.jsonl", "progress file, so a rerun skips finished uploads")
	logPath := fs.String("log", "upload/stems-backfill.log", "also append progress here")
	retryFailed := fs.Bool("retry-failed", false, "try uploads that failed on an earlier run again")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cutoff, err := time.Parse(time.RFC3339, *before)
	if err != nil {
		return fmt.Errorf("-before: %w", err)
	}
	if *maxQueued < 1 || *maxQueued > 20 || *limit < 0 {
		return errors.New("-max-queued must be 1 to 20 and -limit 0 or more")
	}

	sbURL := strings.TrimRight(strings.TrimSpace(env.Get("SUPABASE_URL", "")), "/")
	sbKey := strings.TrimSpace(env.Get("SUPABASE_SERVICE_ROLE_KEY", ""))
	if sbKey == "" {
		sbKey = strings.TrimSpace(env.Get("SUPABASE_ANON_KEY", ""))
	}
	if sbURL == "" || sbKey == "" {
		return errors.New("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
	}
	// Without a working stems sidecar nothing would ever take the jobs off the queue.
	stemsURL := env.Get("STEMS_API_URL", "")
	if stemsURL == "" || stemsURL == "disabled" || env.Get("STEMS_API_SECRET", "") == "" {
		return errors.New("stems are off here (STEMS_API_URL and STEMS_API_SECRET), so queued jobs would never run")
	}
	store := r2.FromEnv()
	if store == nil {
		return errors.New("R2 is not configured")
	}

	out := io.Writer(os.Stdout)
	if *logPath != "" && !*dryRun {
		f, err := os.OpenFile(*logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return fmt.Errorf("log file: %w", err)
		}
		defer f.Close()
		out = io.MultiWriter(os.Stdout, f)
	}
	logger := log.New(out, "stems-backfill ", log.LstdFlags|log.LUTC)

	state, err := openBackfillState(*statePath, *retryFailed, *dryRun)
	if err != nil {
		return err
	}
	defer state.Close()

	var q stemsQueue
	if !*dryRun {
		client, err := queue.NewClient(env.Get("REDIS_ADDR", "localhost:6379"), env.Get("REDIS_PASSWORD", ""), 0, "upload_jobs")
		if err != nil {
			return fmt.Errorf("redis: %w", err)
		}
		defer client.Close()
		q = client
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	b := &stemsBackfill{
		sbURL: sbURL, sbKey: sbKey, store: store, queue: q,
		http:     &http.Client{Timeout: 60 * time.Second},
		stemsDir: backfillStemsDir, workDir: filepath.Dir(*statePath),
		before: cutoff, maxQueued: *maxQueued, limit: *limit, dryRun: *dryRun,
		poll: 30 * time.Second, state: state, log: logger,
	}
	return b.run(ctx)
}

func (b *stemsBackfill) run(ctx context.Context) error {
	all, err := b.candidates(ctx)
	if err != nil {
		return err
	}
	todo := make([]backfillCandidate, 0, len(all))
	skipped := 0
	for _, c := range all {
		if b.state.seen(c.UniqueID) {
			skipped++
			continue
		}
		todo = append(todo, c)
	}
	b.log.Printf("%d music uploads before %s, %d already handled, %d to go",
		len(all), b.before.Format(time.RFC3339), skipped, len(todo))
	if b.dryRun {
		for i, c := range todo {
			if i == 20 {
				b.log.Printf("... and %d more", len(todo)-20)
				break
			}
			b.log.Printf("would queue %s created=%s duration=%.0fs", c.UniqueID, c.CreatedAt, c.Duration)
		}
		return nil
	}

	queued := 0
	for _, c := range todo {
		if b.limit > 0 && queued >= b.limit {
			break
		}
		prefix := c.prefix()
		if prefix == "" {
			b.record(c.UniqueID, "skipped", "row does not describe a usable upload")
			continue
		}
		busy, err := b.waitForRoom(ctx, c.UniqueID)
		if err != nil {
			return err
		}
		if busy {
			b.record(c.UniqueID, "skipped", "already queued")
			continue
		}
		start := time.Now()
		if err := b.queueOne(ctx, c, prefix); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			b.record(c.UniqueID, "failed", err.Error())
			continue
		}
		queued++
		b.record(c.UniqueID, "queued", "")
		b.log.Printf("queued %s duration=%.0fs prepared in %s (%d of %d)",
			c.UniqueID, c.Duration, time.Since(start).Round(time.Second), queued, len(todo))
	}
	b.log.Printf("done: queued %d this run", queued)
	return nil
}

func (b *stemsBackfill) record(id, result, reason string) {
	if result != "queued" {
		b.log.Printf("%s %s: %s", result, id, reason)
	}
	if err := b.state.add(id, result, reason); err != nil {
		b.log.Printf("state write failed for %s: %v", id, err)
	}
}

// candidates pages through published R2 music uploads, newest first.
func (b *stemsBackfill) candidates(ctx context.Context) ([]backfillCandidate, error) {
	var all []backfillCandidate
	for offset := 0; ; offset += backfillPageSize {
		q := url.Values{}
		q.Set("select", "unique_id,owner_id,endpoint,duration,created_at")
		q.Set("is_music", "eq.true")
		q.Set("storage_backend", "eq.r2")
		q.Set("upload_status", "eq.complete")
		q.Add("duration", "gt.0")
		q.Add("duration", "lte."+strconv.Itoa(backfillMaxSeconds))
		q.Set("created_at", "lt."+b.before.UTC().Format(time.RFC3339))
		q.Set("order", "created_at.desc")
		q.Set("limit", strconv.Itoa(backfillPageSize))
		q.Set("offset", strconv.Itoa(offset))
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.sbURL+"/rest/v1/files?"+q.Encode(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("apikey", b.sbKey)
		req.Header.Set("Authorization", "Bearer "+b.sbKey)
		res, err := b.http.Do(req)
		if err != nil {
			return nil, fmt.Errorf("supabase: %w", err)
		}
		var page []backfillCandidate
		if res.StatusCode != http.StatusOK {
			res.Body.Close()
			return nil, fmt.Errorf("supabase status %d", res.StatusCode)
		}
		err = json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(&page)
		res.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("supabase answer: %w", err)
		}
		all = append(all, page...)
		if len(page) < backfillPageSize {
			return all, nil
		}
	}
}

// waitForRoom blocks until the stems queue has fewer than maxQueued jobs.
// busy means this upload is already waiting in it.
func (b *stemsBackfill) waitForRoom(ctx context.Context, id string) (bool, error) {
	for {
		qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		ids, err := b.queue.StemsUploadIDs(qctx)
		cancel()
		if err == nil {
			if ids[id] {
				return true, nil
			}
			if len(ids) < b.maxQueued {
				return false, nil
			}
		} else if ctx.Err() == nil {
			b.log.Printf("queue read failed, retrying: %v", err)
		}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(b.poll):
		}
	}
}

// queueOne rebuilds the upload's audio as stems.flac and queues the job.
func (b *stemsBackfill) queueOne(ctx context.Context, c backfillCandidate, prefix string) error {
	master, err := b.fetchText(ctx, prefix+"master.m3u8")
	if err != nil {
		return fmt.Errorf("master playlist: %w", err)
	}
	playlist := pickAudioPlaylist(master)
	if playlist == "" {
		return errors.New("no usable audio playlist")
	}
	media, err := b.fetchText(ctx, prefix+playlist)
	if err != nil {
		return fmt.Errorf("audio playlist: %w", err)
	}
	segments, err := segmentNames(media, backfillMaxSeconds)
	if err != nil {
		return err
	}

	tmp, err := os.MkdirTemp(b.workDir, "stems-backfill-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	joined := filepath.Join(tmp, "audio.ts")
	if err := b.download(ctx, prefix+path.Dir(playlist)+"/", segments, joined); err != nil {
		return err
	}

	dir := filepath.Join(b.stemsDir, c.OwnerID, c.UniqueID)
	if err := ffmpeg.ExtractStemsAudio(joined, filepath.Join(dir, "stems.flac"), backfillMaxSeconds); err != nil {
		os.RemoveAll(dir)
		return err
	}
	qctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	err = b.queue.PushStemsJob(qctx, &queue.StemsJob{
		UploadID:  c.UniqueID,
		UserID:    c.OwnerID,
		Prefix:    prefix,
		Duration:  c.Duration,
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		os.RemoveAll(dir)
		return fmt.Errorf("queue: %w", err)
	}
	return nil
}

func (b *stemsBackfill) open(ctx context.Context, key string) (*http.Response, error) {
	signed, err := b.store.PresignGet(key, 10*time.Minute)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, signed, nil)
	if err != nil {
		return nil, err
	}
	res, err := b.http.Do(req)
	if err != nil {
		// The error repeats the signed link, which must not reach the log.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("status %d", res.StatusCode)
	}
	return res, nil
}

func (b *stemsBackfill) fetchText(ctx context.Context, key string) (string, error) {
	res, err := b.open(ctx, key)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	return string(body), err
}

// download joins the segments into one MPEG-TS file, which ffmpeg reads like
// the original.
func (b *stemsBackfill) download(ctx context.Context, dir string, segments []string, out string) error {
	f, err := os.OpenFile(out, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	var total int64
	for _, name := range segments {
		res, err := b.open(ctx, dir+name)
		if err != nil {
			return fmt.Errorf("segment %s: %w", name, err)
		}
		n, err := io.Copy(f, io.LimitReader(res.Body, backfillMaxBytes-total+1))
		res.Body.Close()
		if err != nil {
			return fmt.Errorf("segment %s: %w", name, err)
		}
		if total += n; total > backfillMaxBytes {
			return errors.New("audio over the size cap")
		}
	}
	return f.Close()
}

// pickAudioPlaylist is the best audio rendition the master lists, or the first
// variant when the audio rides inside the video.
func pickAudioPlaylist(master string) string {
	rank := map[string]int{"audio_high": 3, "audio_mid": 2, "audio_low": 1}
	best, bestRank := "", -1
	firstVariant := ""
	wantVariant := false
	for _, raw := range strings.Split(master, "\n") {
		line := strings.TrimSpace(raw)
		switch {
		case strings.HasPrefix(line, "#EXT-X-MEDIA:") && strings.Contains(line, "TYPE=AUDIO"):
			m := backfillMediaURIRe.FindStringSubmatch(line)
			if m == nil || !backfillPlaylistRe.MatchString(m[1]) {
				continue
			}
			if r := rank[path.Dir(m[1])]; r > bestRank {
				best, bestRank = m[1], r
			}
		case strings.HasPrefix(line, "#EXT-X-STREAM-INF"):
			wantVariant = true
		case wantVariant && line != "" && !strings.HasPrefix(line, "#"):
			wantVariant = false
			if firstVariant == "" && backfillPlaylistRe.MatchString(line) {
				firstVariant = line
			}
		}
	}
	if best != "" {
		return best
	}
	return firstVariant
}

// segmentNames lists the media playlist's segments up to maxSeconds of audio.
func segmentNames(media string, maxSeconds float64) ([]string, error) {
	var names []string
	seconds := 0.0
	for _, raw := range strings.Split(media, "\n") {
		line := strings.TrimSpace(raw)
		switch {
		case line == "":
		case strings.HasPrefix(line, "#EXT-X-MAP"), strings.HasPrefix(line, "#EXT-X-KEY"), strings.HasPrefix(line, "#EXT-X-BYTERANGE"):
			return nil, errors.New("audio playlist uses a layout this can't join")
		case strings.HasPrefix(line, "#EXTINF:"):
			d, _ := strconv.ParseFloat(strings.SplitN(line[len("#EXTINF:"):], ",", 2)[0], 64)
			seconds += d
		case strings.HasPrefix(line, "#"):
		default:
			if !backfillSegmentRe.MatchString(line) {
				return nil, fmt.Errorf("unexpected segment name %q", line)
			}
			names = append(names, line)
			if len(names) > backfillMaxSegments {
				return nil, errors.New("too many segments")
			}
			if seconds >= maxSeconds {
				return names, nil
			}
		}
	}
	if len(names) == 0 {
		return nil, errors.New("audio playlist has no segments")
	}
	return names, nil
}

// backfillState is the run's progress, one JSON line per upload handled.
type backfillState struct {
	done map[string]bool
	f    *os.File
}

type backfillStateLine struct {
	Upload string `json:"upload"`
	Result string `json:"result"`
	Reason string `json:"reason,omitempty"`
	At     string `json:"at"`
}

func openBackfillState(p string, retryFailed, readOnly bool) (*backfillState, error) {
	s := &backfillState{done: map[string]bool{}}
	if f, err := os.Open(p); err == nil {
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			var line backfillStateLine
			if json.Unmarshal(scanner.Bytes(), &line) != nil || line.Upload == "" {
				continue
			}
			s.done[line.Upload] = line.Result != "failed" || !retryFailed
		}
		f.Close()
		if err := scanner.Err(); err != nil {
			return nil, fmt.Errorf("state file: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("state file: %w", err)
	}
	if readOnly {
		return s, nil
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("state file: %w", err)
	}
	s.f = f
	return s, nil
}

func (s *backfillState) seen(id string) bool { return s.done[id] }

func (s *backfillState) add(id, result, reason string) error {
	s.done[id] = true
	if s.f == nil {
		return nil
	}
	line, _ := json.Marshal(backfillStateLine{Upload: id, Result: result, Reason: reason, At: time.Now().UTC().Format(time.RFC3339)})
	_, err := s.f.Write(append(line, '\n'))
	return err
}

func (s *backfillState) Close() error {
	if s.f == nil {
		return nil
	}
	return s.f.Close()
}
