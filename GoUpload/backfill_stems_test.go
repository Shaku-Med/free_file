package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"goupload/lib/queue"
	"goupload/lib/r2"
)

func TestPickAudioPlaylist(t *testing.T) {
	cases := map[string]string{
		"#EXTM3U\n" +
			`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud-low",URI="audio_low/audio.m3u8"` + "\n" +
			`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud-high",URI="audio_high/audio.m3u8"` + "\n" +
			"#EXT-X-STREAM-INF:BANDWIDTH=1\n720p/playlist.m3u8\n": "audio_high/audio.m3u8",
		"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n360p/playlist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\n720p/playlist.m3u8\n":           "360p/playlist.m3u8",
		"#EXTM3U\n" + `#EXT-X-MEDIA:TYPE=AUDIO,URI="../other/audio.m3u8"` + "\n#EXT-X-STREAM-INF:BANDWIDTH=1\n360p/playlist.m3u8\n": "360p/playlist.m3u8",
		"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://elsewhere.example/a/playlist.m3u8\n":                                       "",
	}
	for master, want := range cases {
		if got := pickAudioPlaylist(master); got != want {
			t.Errorf("pickAudioPlaylist(%q) = %q, want %q", master, got, want)
		}
	}
}

func TestSegmentNames(t *testing.T) {
	media := "#EXTM3U\n#EXTINF:6.000000,\nsegment_000.ts\n#EXTINF:6.0,\nsegment_001.ts\n#EXTINF:6.0,\nsegment_002.ts\n#EXT-X-ENDLIST\n"
	got, err := segmentNames(media, 1200)
	if err != nil || strings.Join(got, ",") != "segment_000.ts,segment_001.ts,segment_002.ts" {
		t.Fatalf("got %v err=%v", got, err)
	}
	if got, _ := segmentNames(media, 10); len(got) != 2 {
		t.Fatalf("a 10 second cap took %v", got)
	}
	for _, bad := range []string{
		"#EXTINF:6,\n../secret.ts\n",
		"#EXTINF:6,\nhttps://elsewhere.example/a.ts\n",
		"#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6,\nseg.ts\n",
		"#EXT-X-ENDLIST\n",
	} {
		if _, err := segmentNames(bad, 1200); err == nil {
			t.Errorf("segmentNames(%q) accepted it", bad)
		}
	}
}

func TestCandidatePrefix(t *testing.T) {
	const id = "0123456789abcdef0123456789abcdef"
	ok := backfillCandidate{UniqueID: id, OwnerID: "user_1", Endpoint: "01_02_2026/" + id + "/master.m3u8", Duration: 200}
	if got := ok.prefix(); got != "01_02_2026/"+id+"/" {
		t.Fatalf("prefix = %q", got)
	}
	bad := []backfillCandidate{
		{UniqueID: "nothex", OwnerID: "u", Endpoint: "01_02_2026/nothex/master.m3u8", Duration: 200},
		{UniqueID: id, OwnerID: "u/../x", Endpoint: ok.Endpoint, Duration: 200},
		{UniqueID: id, OwnerID: "u", Endpoint: ok.Endpoint, Duration: 0},
		{UniqueID: id, OwnerID: "u", Endpoint: ok.Endpoint, Duration: 1300},
		{UniqueID: id, OwnerID: "u", Endpoint: "01_02_2026/fedcba9876543210fedcba9876543210/master.m3u8", Duration: 200},
		{UniqueID: id, OwnerID: "u", Endpoint: "../01_02_2026/" + id + "/master.m3u8", Duration: 200},
		{UniqueID: id, OwnerID: "u", Endpoint: "", Duration: 200},
	}
	for _, c := range bad {
		if p := c.prefix(); p != "" {
			t.Errorf("%+v gave prefix %q", c, p)
		}
	}
}

func TestBackfillStateResumes(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.jsonl")
	s, err := openBackfillState(p, false, false)
	if err != nil {
		t.Fatal(err)
	}
	s.add("a", "queued", "")
	s.add("b", "failed", "no audio")
	s.Close()

	again, _ := openBackfillState(p, false, true)
	if !again.seen("a") || !again.seen("b") || again.seen("c") {
		t.Fatalf("resume lost track: %v", again.done)
	}
	retry, _ := openBackfillState(p, true, true)
	if !retry.seen("a") || retry.seen("b") {
		t.Fatalf("-retry-failed should only reopen failures: %v", retry.done)
	}
}

type fakeStemsQueue struct {
	mu     sync.Mutex
	ids    map[string]bool
	pushed []queue.StemsJob
}

func (q *fakeStemsQueue) StemsUploadIDs(context.Context) (map[string]bool, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := map[string]bool{}
	for k, v := range q.ids {
		out[k] = v
	}
	return out, nil
}

func (q *fakeStemsQueue) PushStemsJob(_ context.Context, job *queue.StemsJob) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.pushed = append(q.pushed, *job)
	return nil
}

func TestBackfillQueuesOldMusicEndToEnd(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	const id = "0123456789abcdef0123456789abcdef"
	const owner = "owner_1"
	prefix := "01_02_2026/" + id + "/"

	// A real two segment HLS audio rendition, as the transcoder writes one.
	hlsDir := t.TempDir()
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
		"-c:a", "aac", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
		"-hls_segment_filename", filepath.Join(hlsDir, "segment_%03d.ts"), filepath.Join(hlsDir, "audio.m3u8"))
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, out)
	}
	objects := map[string][]byte{
		prefix + "master.m3u8": []byte("#EXTM3U\n" +
			`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud-low",URI="audio_low/audio.m3u8"` + "\n" +
			"#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO=\"aud-low\"\n360p/playlist.m3u8\n"),
	}
	entries, _ := os.ReadDir(hlsDir)
	for _, e := range entries {
		data, _ := os.ReadFile(filepath.Join(hlsDir, e.Name()))
		objects[prefix+"audio_low/"+e.Name()] = data
	}

	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/media/")
		data, ok := objects[key]
		if !ok || r.URL.Query().Get("X-Amz-Signature") == "" {
			http.NotFound(w, r)
			return
		}
		w.Write(data)
	}))
	defer storage.Close()
	store, err := r2.New(r2.Config{AccessKeyID: "AKID", SecretAccessKey: "secret", Bucket: "media", Endpoint: storage.URL})
	if err != nil {
		t.Fatal(err)
	}

	var sawQuery string
	db := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawQuery = r.URL.RawQuery
		if r.Header.Get("apikey") != "service" {
			http.Error(w, "no key", http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode([]backfillCandidate{
			{UniqueID: id, OwnerID: owner, Endpoint: prefix + "master.m3u8", Duration: 4, CreatedAt: "2026-02-01T00:00:00Z"},
			{UniqueID: "fedcba9876543210fedcba9876543210", OwnerID: owner, Endpoint: "../escape/master.m3u8", Duration: 4},
		})
	}))
	defer db.Close()

	// StemsAPI is still starting when room opens, so nothing may be queued yet.
	var stemsReady atomic.Bool
	var stemsRefused atomic.Int32
	stems := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		if !stemsReady.Load() {
			stemsRefused.Add(1)
			http.Error(w, "starting", http.StatusServiceUnavailable)
			return
		}
		io.WriteString(w, `{"status":"ok","inflight":0}`)
	}))
	defer stems.Close()

	work := t.TempDir()
	stemsDir := filepath.Join(work, "stems")
	state, _ := openBackfillState(filepath.Join(work, "state.jsonl"), false, false)
	// The queue starts full, so the backfill has to wait its turn.
	q := &fakeStemsQueue{ids: map[string]bool{"live1": true, "live2": true}}
	go func() {
		time.Sleep(100 * time.Millisecond)
		q.mu.Lock()
		q.ids = map[string]bool{}
		q.mu.Unlock()
		time.Sleep(100 * time.Millisecond)
		stemsReady.Store(true)
	}()
	var logs bytes.Buffer
	b := &stemsBackfill{
		sbURL: db.URL, sbKey: "service", store: store, queue: q,
		http: &http.Client{Timeout: 10 * time.Second}, stemsDir: stemsDir, workDir: work,
		stemsHealth: stems.URL + "/health",
		before:      stemsBackfillCutoff, maxQueued: 2, poll: 20 * time.Millisecond, state: state,
		log: log.New(&logs, "", 0),
	}
	if err := b.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	state.Close()

	for _, want := range []string{"is_music=eq.true", "storage_backend=eq.r2", "created_at=lt.2026-11-15T08%3A23%3A00Z"} {
		if !strings.Contains(sawQuery, want) {
			t.Errorf("query %q is missing %q", sawQuery, want)
		}
	}
	if len(q.pushed) != 1 {
		t.Fatalf("pushed %d jobs, want 1\n%s", len(q.pushed), logs.String())
	}
	job := q.pushed[0]
	if job.UploadID != id || job.UserID != owner || job.Prefix != prefix || job.Duration != 4 || time.Since(job.CreatedAt) > time.Minute {
		t.Fatalf("job = %+v", job)
	}
	flac, err := os.ReadFile(filepath.Join(stemsDir, owner, id, "stems.flac"))
	if err != nil || !bytes.HasPrefix(flac, []byte("fLaC")) {
		t.Fatalf("stems.flac missing or not FLAC: %v", err)
	}
	leftovers, _ := filepath.Glob(filepath.Join(work, "stems-backfill-*"))
	if len(leftovers) != 0 {
		t.Fatalf("temp folders left behind: %v", leftovers)
	}
	saved, _ := os.ReadFile(filepath.Join(work, "state.jsonl"))
	if !strings.Contains(string(saved), `"result":"queued"`) || !strings.Contains(string(saved), `"result":"skipped"`) {
		t.Fatalf("state file:\n%s", saved)
	}
	if strings.Contains(logs.String(), "X-Amz-Signature") {
		t.Fatalf("a signed link reached the log")
	}
	if stemsRefused.Load() == 0 || !strings.Contains(logs.String(), "waiting before queueing more") || !strings.Contains(logs.String(), "StemsAPI is back") {
		t.Fatalf("did not wait for StemsAPI (refused %d)\n%s", stemsRefused.Load(), logs.String())
	}
	if n := strings.Count(logs.String(), "is not answering"); n != 1 {
		t.Fatalf("logged the outage %d times, want once", n)
	}

	// A rerun picks up where the first left off and queues nothing new.
	state2, _ := openBackfillState(filepath.Join(work, "state.jsonl"), false, false)
	b.state = state2
	if err := b.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	state2.Close()
	if len(q.pushed) != 1 {
		t.Fatalf("rerun queued again: %d jobs", len(q.pushed))
	}
}

func TestBackfillLockStopsASecondRun(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.jsonl.lock")
	unlock, err := lockBackfill(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lockBackfill(p); !errors.Is(err, errBackfillRunning) {
		t.Fatalf("second lock = %v, want errBackfillRunning", err)
	}
	unlock()
	unlock2, err := lockBackfill(p)
	if err != nil {
		t.Fatalf("lock after release: %v", err)
	}
	unlock2()
}

func TestStemsHealthURL(t *testing.T) {
	for in, want := range map[string]string{
		"http://stemsapi:3010/separate":     "http://stemsapi:3010/health",
		"https://box/stems/separate?a=b#c":  "https://box/stems/health",
		"http://u:p@stemsapi:3010/separate": "http://stemsapi:3010/health",
		"ftp://stemsapi/separate":           "",
		"stemsapi:3010/separate":            "",
		"http:///separate":                  "",
	} {
		got, err := stemsHealthURL(in)
		if want == "" {
			if err == nil {
				t.Errorf("%q: accepted as %q", in, got)
			}
			continue
		}
		if err != nil || got != want {
			t.Errorf("%q = %q, %v; want %q", in, got, err, want)
		}
	}
}

func TestWaitForStemsStopsWithContext(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusBadGateway)
	}))
	defer down.Close()
	b := &stemsBackfill{http: &http.Client{Timeout: time.Second}, stemsHealth: down.URL + "/health",
		poll: 5 * time.Millisecond, log: log.New(io.Discard, "", 0)}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := b.waitForStems(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waitForStems = %v, want the context's deadline", err)
	}
}

func TestBackfillFailureLeavesNothingBehind(t *testing.T) {
	const id = "0123456789abcdef0123456789abcdef"
	storage := httptest.NewServer(http.NotFoundHandler())
	defer storage.Close()
	store, _ := r2.New(r2.Config{AccessKeyID: "AKID", SecretAccessKey: "secret", Bucket: "media", Endpoint: storage.URL})
	db := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `[{"unique_id":"`+id+`","owner_id":"o","endpoint":"01_02_2026/`+id+`/master.m3u8","duration":30}]`)
	}))
	defer db.Close()
	work := t.TempDir()
	state, _ := openBackfillState(filepath.Join(work, "state.jsonl"), false, false)
	q := &fakeStemsQueue{ids: map[string]bool{}}
	b := &stemsBackfill{
		sbURL: db.URL, sbKey: "k", store: store, queue: q,
		http: &http.Client{Timeout: 5 * time.Second}, stemsDir: filepath.Join(work, "stems"), workDir: work,
		before: stemsBackfillCutoff, maxQueued: 2, poll: time.Millisecond, state: state,
		log: log.New(io.Discard, "", 0),
	}
	if err := b.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	state.Close()
	if len(q.pushed) != 0 {
		t.Fatalf("queued a job with no audio")
	}
	if _, err := os.Stat(filepath.Join(work, "stems")); !os.IsNotExist(err) {
		t.Fatalf("left a stems folder behind")
	}
	saved, _ := os.ReadFile(filepath.Join(work, "state.jsonl"))
	if !strings.Contains(string(saved), `"result":"failed"`) {
		t.Fatalf("failure not recorded:\n%s", saved)
	}
}
