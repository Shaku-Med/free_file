package upload

import (
	"bytes"
	"testing"
	"time"
)

const testChunk = 64

func testManager(t *testing.T) *Manager {
	t.Helper()
	return testManagerWith(t, ManagerConfig{MaxDiskBytes: 1 << 30, MaxConcurrent: 2})
}

func testManagerWith(t *testing.T, cfg ManagerConfig) *Manager {
	t.Helper()
	cfg.BaseDir = t.TempDir()
	if cfg.ChunkSize == 0 {
		cfg.ChunkSize = testChunk
	}
	m := NewManager(cfg)
	m.freeSpace = func(string) (int64, error) { return 1 << 40, nil }
	return m
}

// testFileSize is two chunks, the second holding the 4 byte remainder.
const testFileSize = testChunk + 4

func startFile(t *testing.T, m *Manager, user, name string) (string, *BusyReason) {
	t.Helper()
	resp, busy, err := m.StartUpload(user, StartRequest{FileName: name, FileSize: testFileSize, TotalChunks: 2}, nil)
	if err != nil {
		t.Fatalf("start %s: %v", name, err)
	}
	return resp.UploadID, busy
}

// goSilent makes an upload look like its browser went away.
func goSilent(m *Manager, uploadID string) {
	m.activeMu.Lock()
	defer m.activeMu.Unlock()
	info := m.active[uploadID]
	info.LastChunkReceivedAt = time.Now().Add(-activeIdleLimit - time.Second)
	m.active[uploadID] = info
}

func wantBusy(t *testing.T, busy *BusyReason, reason string) {
	t.Helper()
	if busy == nil || busy.Reason != reason {
		t.Fatalf("got %+v, want busy with %s", busy, reason)
	}
}

func wantFree(t *testing.T, busy *BusyReason) {
	t.Helper()
	if busy != nil {
		t.Fatalf("got busy with %s, want a free slot", busy.Reason)
	}
}

func TestLiveUploadStillBlocksSecondFromSameUser(t *testing.T) {
	m := testManager(t)
	_, busy := startFile(t, m, "alice", "a.mp4")
	wantFree(t, busy)
	_, busy = startFile(t, m, "alice", "b.mp4")
	wantBusy(t, busy, "user_active_upload")
}

func TestDeadUploadStopsBlockingItsUser(t *testing.T) {
	m := testManager(t)
	id, _ := startFile(t, m, "alice", "a.mp4")
	goSilent(m, id)
	_, busy := startFile(t, m, "alice", "b.mp4")
	wantFree(t, busy)
}

func TestDeadUploadsStopFillingTheServer(t *testing.T) {
	m := testManager(t)
	first, _ := startFile(t, m, "alice", "a.mp4")
	second, _ := startFile(t, m, "bob", "b.mp4")
	_, busy := startFile(t, m, "carol", "c.mp4")
	wantBusy(t, busy, "too_many_uploads")

	goSilent(m, first)
	goSilent(m, second)
	_, busy = startFile(t, m, "carol", "c.mp4")
	wantFree(t, busy)
}

func TestNextChunkTakesTheSlotBack(t *testing.T) {
	m := testManager(t)
	id, _ := startFile(t, m, "alice", "a.mp4")
	goSilent(m, id)
	m.forgetIdle()
	if m.userHasActive("alice") {
		t.Fatal("silent upload should have lost its slot")
	}
	if _, err := m.SaveChunk("alice", id, 1, bytes.NewReader([]byte("part"))); err != nil {
		t.Fatalf("chunk: %v", err)
	}
	_, busy := startFile(t, m, "alice", "b.mp4")
	wantBusy(t, busy, "user_active_upload")
}

func TestSameFileResumesAfterGoingSilent(t *testing.T) {
	m := testManager(t)
	id, _ := startFile(t, m, "alice", "a.mp4")
	goSilent(m, id)
	resumed, busy := startFile(t, m, "alice", "a.mp4")
	wantFree(t, busy)
	if resumed != id {
		t.Fatalf("resumed as %s, want %s", resumed, id)
	}
	// A resume counts as activity, so it holds the slot again.
	_, busy = startFile(t, m, "alice", "b.mp4")
	wantBusy(t, busy, "user_active_upload")
}
