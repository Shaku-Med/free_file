package worker

import (
	"os"
	"path/filepath"
	"testing"
)

// A user's folder of assembled files holds their other uploads too, so cleaning
// up one job must never take the folder with it while it still has files.
func TestRemoveLocalKeepsTheUsersOtherUploads(t *testing.T) {
	root := filepath.Join(t.TempDir(), "assembled")
	userDir := filepath.Join(root, "user1")
	if err := os.MkdirAll(userDir, 0o700); err != nil {
		t.Fatal(err)
	}
	mine := filepath.Join(userDir, "a_clip.mp4")
	theirs := filepath.Join(userDir, "b_other.mp4")
	for _, f := range []string{mine, theirs} {
		if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	(&Worker{}).removeLocal(mine, userDir)

	if _, err := os.Stat(mine); !os.IsNotExist(err) {
		t.Errorf("this job's file should be gone, stat err=%v", err)
	}
	if _, err := os.Stat(theirs); err != nil {
		t.Errorf("another upload's file was deleted: %v", err)
	}

	// Once nothing else is in it, the folder goes too.
	(&Worker{}).removeLocal(theirs, userDir)
	if _, err := os.Stat(userDir); !os.IsNotExist(err) {
		t.Errorf("empty user folder should be removed, stat err=%v", err)
	}
}

// A job's own folder (hls/<user>/<upload>) is still removed whole.
func TestRemoveLocalClearsAJobsOwnFolder(t *testing.T) {
	jobDir := filepath.Join(t.TempDir(), "hls", "user1", "upload1")
	if err := os.MkdirAll(filepath.Join(jobDir, "360p"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(jobDir, "360p", "segment_000.ts"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	(&Worker{}).removeLocal(jobDir)
	if _, err := os.Stat(jobDir); !os.IsNotExist(err) {
		t.Errorf("job folder should be removed, stat err=%v", err)
	}
}
