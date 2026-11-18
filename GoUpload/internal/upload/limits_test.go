package upload

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// mkvBytes is n bytes that sniff as a Matroska video.
func mkvBytes(n int) []byte {
	b := make([]byte, n)
	copy(b, "\x1A\x45\xDF\xA3")
	return b
}

func startSized(t *testing.T, m *Manager, user, name string, size int64) string {
	t.Helper()
	chunks := int((size + m.chunkSize - 1) / m.chunkSize)
	resp, busy, err := m.StartUpload(user, StartRequest{FileName: name, FileSize: size, TotalChunks: chunks}, nil)
	if err != nil || busy != nil {
		t.Fatalf("start %s: err=%v busy=%+v", name, err, busy)
	}
	return resp.UploadID
}

func sendChunk(t *testing.T, m *Manager, user, id string, index int, n int) {
	t.Helper()
	if _, err := m.SaveChunk(user, id, index, bytes.NewReader(mkvBytes(n))); err != nil {
		t.Fatalf("chunk %d: %v", index, err)
	}
}

// uploadWhole sends every chunk of a fresh testFileSize upload.
func uploadWhole(t *testing.T, m *Manager, user, name string) string {
	t.Helper()
	id := startSized(t, m, user, name, testFileSize)
	sendChunk(t, m, user, id, 0, testChunk)
	sendChunk(t, m, user, id, 1, testFileSize-testChunk)
	return id
}

// abandon makes an upload look untouched for d, with its browser gone.
func abandon(t *testing.T, m *Manager, user, id string, d time.Duration) {
	t.Helper()
	p := metaPath(m.baseDir, user, id)
	meta, err := readMeta(p)
	if err != nil {
		t.Fatal(err)
	}
	meta.CreatedAt = time.Now().Add(-d)
	meta.LastActivity = meta.CreatedAt
	b, _ := json.Marshal(meta)
	if err := os.WriteFile(p, b, 0600); err != nil {
		t.Fatal(err)
	}
	goSilent(m, id)
}

func exists(m *Manager, user, id string) bool {
	_, err := os.Stat(filepath.Join(m.baseDir, user, id))
	return err == nil
}

func TestStartRefusesFilesOverTheLimit(t *testing.T) {
	m := testManagerWith(t, ManagerConfig{MaxFileBytes: 3 * testChunk})
	_, _, err := m.StartUpload("alice", StartRequest{FileName: "a.mkv", FileSize: 3*testChunk + 1, TotalChunks: 4}, nil)
	if !errors.Is(err, ErrFileTooLarge) {
		t.Fatalf("got %v, want ErrFileTooLarge", err)
	}
	if _, _, err := m.StartUpload("alice", StartRequest{FileName: "a.mkv", FileSize: 3 * testChunk, TotalChunks: 3}, nil); err != nil {
		t.Fatalf("a file at the limit: %v", err)
	}
}

func TestStartNeedsExactlyTheChunksItsSizeTakes(t *testing.T) {
	m := testManager(t)
	for _, n := range []int{1, 3, 1_000_000} {
		_, _, err := m.StartUpload("alice", StartRequest{FileName: "a.mkv", FileSize: testFileSize, TotalChunks: n}, nil)
		if err == nil || err.Error() != "invalid_chunks" {
			t.Fatalf("total_chunks=%d: got %v, want invalid_chunks", n, err)
		}
	}
}

func TestChunksMustBeExactlyTheirSize(t *testing.T) {
	m := testManager(t)
	id := startSized(t, m, "alice", "a.mkv", testFileSize)
	bad := []struct{ index, n int }{
		{0, testChunk - 1}, {0, testChunk + 1}, {1, 3}, {1, 5}, {1, testChunk},
	}
	for _, b := range bad {
		_, err := m.SaveChunk("alice", id, b.index, bytes.NewReader(mkvBytes(b.n)))
		if !errors.Is(err, ErrChunkSize) {
			t.Fatalf("chunk %d with %d bytes: got %v, want ErrChunkSize", b.index, b.n, err)
		}
		if _, err := os.Stat(chunkPath(m.baseDir, "alice", id, b.index)); !os.IsNotExist(err) {
			t.Fatalf("chunk %d with %d bytes was left on disk", b.index, b.n)
		}
	}
	sendChunk(t, m, "alice", id, 0, testChunk)
	sendChunk(t, m, "alice", id, 1, testFileSize-testChunk)
	if got, _ := m.ChunkFolderSize("alice", id); got != testFileSize {
		t.Fatalf("on disk %d bytes, want exactly the declared %d", got, testFileSize)
	}
}

func TestChunkRefusedWhenTheDiskIsLow(t *testing.T) {
	m := testManagerWith(t, ManagerConfig{MinFreeBytes: 1 << 30})
	id := startSized(t, m, "alice", "a.mkv", testFileSize)
	m.freeSpace = func(string) (int64, error) { return 1<<30 + testChunk - 1, nil }
	if _, err := m.SaveChunk("alice", id, 0, bytes.NewReader(mkvBytes(testChunk))); !errors.Is(err, ErrDiskFull) {
		t.Fatalf("got %v, want ErrDiskFull", err)
	}
	m.freeSpace = func(string) (int64, error) { return 1<<30 + testChunk, nil }
	sendChunk(t, m, "alice", id, 0, testChunk)
}

func TestCompleteQueuesAnUploadOnce(t *testing.T) {
	m := testManager(t)
	id := uploadWhole(t, m, "alice", "a.mkv")

	first, err := m.BeginComplete("alice", id)
	if err != nil || first.JobID != "" {
		t.Fatalf("first complete: %+v %v", first, err)
	}
	if _, err := m.BeginComplete("alice", id); !errors.Is(err, ErrCompleteInProgress) {
		t.Fatalf("second complete while the first queues: got %v", err)
	}
	if err := m.FinishComplete("alice", id, "job-1"); err != nil {
		t.Fatal(err)
	}
	again, err := m.BeginComplete("alice", id)
	if err != nil || again.JobID != "job-1" {
		t.Fatalf("complete after queueing: %+v %v, want job-1", again, err)
	}
	// A repeat chunk is answered, never written again.
	sendChunk(t, m, "alice", id, 0, testChunk)
	if m.isLive(id) {
		t.Fatal("a queued upload must not hold an upload slot")
	}
}

func TestFailedCompleteCanBeRetried(t *testing.T) {
	m := testManager(t)
	id := uploadWhole(t, m, "alice", "a.mkv")
	if _, err := m.BeginComplete("alice", id); err != nil {
		t.Fatal(err)
	}
	m.AbortComplete(id)
	if _, err := m.BeginComplete("alice", id); err != nil {
		t.Fatalf("retry after an aborted complete: %v", err)
	}
}

func TestNewUploadClearsTheSameUsersOldestParkedUploads(t *testing.T) {
	m := testManagerWith(t, ManagerConfig{MaxFileBytes: 3 * testChunk, MaxConcurrent: 10})

	queued := uploadWhole(t, m, "alice", "q.mkv")
	if _, err := m.BeginComplete("alice", queued); err != nil {
		t.Fatal(err)
	}
	if err := m.FinishComplete("alice", queued, "job-q"); err != nil {
		t.Fatal(err)
	}
	bobs := startSized(t, m, "bob", "x.mkv", testFileSize)
	goSilent(m, bobs)

	a := startSized(t, m, "alice", "a.mkv", testFileSize)
	abandon(t, m, "alice", a, 2*time.Minute)
	b := startSized(t, m, "alice", "b.mkv", testFileSize)
	abandon(t, m, "alice", b, time.Minute)
	if !exists(m, "alice", a) {
		t.Fatal("one parked upload plus the new one fit; nothing should go")
	}

	c := startSized(t, m, "alice", "c.mkv", 3*testChunk)
	if exists(m, "alice", a) || exists(m, "alice", b) {
		t.Fatal("alice's idle uploads should have made room for a max size one")
	}
	if !exists(m, "alice", c) || !exists(m, "alice", queued) || !exists(m, "bob", bobs) {
		t.Fatal("the new upload, the queued one and bob's must all stay")
	}
}

func TestStaleUploadsMakeRoomWhenTheDiskIsShort(t *testing.T) {
	m := testManagerWith(t, ManagerConfig{ChunkSize: 4096, MaxDiskBytes: 24_000, MaxConcurrent: 10})

	recent := startSized(t, m, "carol", "y.mkv", 8192)
	sendChunk(t, m, "carol", recent, 0, 4096)
	abandon(t, m, "carol", recent, 30*time.Minute)

	old := startSized(t, m, "bob", "x.mkv", 8192)
	sendChunk(t, m, "bob", old, 0, 4096)
	abandon(t, m, "bob", old, 2*time.Hour)

	// 8 KB on disk plus twice the new file is over the budget, until bob's
	// hours old upload goes.
	startSized(t, m, "alice", "z.mkv", 8000)
	if exists(m, "bob", old) {
		t.Fatal("an upload abandoned for hours should give its space up")
	}
	if !exists(m, "carol", recent) {
		t.Fatal("a recently paused upload must stay resumable")
	}

	_, busy, err := m.StartUpload("dave", StartRequest{FileName: "w.mkv", FileSize: 8192, TotalChunks: 2}, nil)
	if err != nil {
		t.Fatal(err)
	}
	wantBusy(t, busy, "disk_limit")
	if !exists(m, "carol", recent) {
		t.Fatal("nothing stale was left to take, so carol's upload must stay")
	}
}

func TestRunningUploadsHoldTheirSpace(t *testing.T) {
	m := testManagerWith(t, ManagerConfig{ChunkSize: 4096, MaxDiskBytes: 40_000, MaxConcurrent: 10})
	for _, u := range []string{"a", "b", "c"} {
		startSized(t, m, u, "f.mkv", 8192)
	}
	// Nothing is written yet, but the three still have 24 KB to send.
	_, busy, err := m.StartUpload("d", StartRequest{FileName: "f.mkv", FileSize: 8192, TotalChunks: 2}, nil)
	if err != nil {
		t.Fatal(err)
	}
	wantBusy(t, busy, "disk_limit")
}

func TestAdmitRunsOnlyForNewUploads(t *testing.T) {
	m := testManager(t)
	calls := 0
	admit := func() error { calls++; return nil }
	req := StartRequest{FileName: "a.mkv", FileSize: testFileSize, TotalChunks: 2}

	first, _, err := m.StartUpload("alice", req, admit)
	if err != nil || calls != 1 {
		t.Fatalf("new upload: err=%v calls=%d", err, calls)
	}
	goSilent(m, first.UploadID)
	again, _, err := m.StartUpload("alice", req, admit)
	if err != nil || again.UploadID != first.UploadID || calls != 1 {
		t.Fatalf("a resume must not count: err=%v calls=%d", err, calls)
	}

	goSilent(m, first.UploadID)
	capped := errors.New("capped")
	_, _, err = m.StartUpload("alice", StartRequest{FileName: "b.mkv", FileSize: testFileSize, TotalChunks: 2}, func() error { return capped })
	if !errors.Is(err, capped) {
		t.Fatalf("got %v, want the admit error", err)
	}
	entries, _ := os.ReadDir(filepath.Join(m.baseDir, "alice"))
	if len(entries) != 1 {
		t.Fatalf("a refused upload left %d folders, want only the first", len(entries))
	}
}
