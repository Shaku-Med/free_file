package assembler

import (
	"os"
	"path/filepath"
	"testing"
)

func testConfig(t *testing.T) Config {
	t.Helper()
	root := t.TempDir()
	return Config{
		ChunksDir:   filepath.Join(root, "temp"),
		OutputDir:   filepath.Join(root, "assembled"),
		UserID:      "user1",
		UploadID:    "0123456789abcdef0123456789abcdef",
		FileName:    "clip.mp4",
		TotalChunks: 2,
	}
}

func writeChunks(t *testing.T, cfg Config, n int) {
	t.Helper()
	dir := filepath.Join(cfg.ChunksDir, cfg.UserID, cfg.UploadID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		if err := os.WriteFile(filepath.Join(dir, "chunk_"+string(rune('0'+i))), []byte("data"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestResumeFromChunksOrFromTheAssembledFile(t *testing.T) {
	cfg := testConfig(t)
	if Resumable(cfg) {
		t.Fatal("nothing on disk yet, should not be resumable")
	}

	writeChunks(t, cfg, 1)
	if Resumable(cfg) {
		t.Fatal("one of two chunks is not enough to run again")
	}
	writeChunks(t, cfg, 2)
	if !Resumable(cfg) {
		t.Fatal("every chunk is there, it should run again")
	}

	res, err := Assemble(cfg)
	if err != nil {
		t.Fatal(err)
	}
	// While the chunks are still there the file may be half written: rebuild it.
	if _, ok := Previous(cfg); ok {
		t.Fatal("the assembled file must not be reused while its chunks remain")
	}

	// The worker deletes the chunks after a good assembly; from then on the file is it.
	if err := Cleanup(cfg.ChunksDir, cfg.UserID, cfg.UploadID); err != nil {
		t.Fatal(err)
	}
	prev, ok := Previous(cfg)
	if !ok || prev.OutputPath != res.OutputPath || prev.FileSize != res.FileSize {
		t.Fatalf("Previous = %+v, %v; want the assembled file %+v", prev, ok, res)
	}
	if !Resumable(cfg) {
		t.Fatal("the assembled file alone should be enough to run again")
	}

	// Both gone: nothing to carry on from.
	if err := os.Remove(res.OutputPath); err != nil {
		t.Fatal(err)
	}
	if Resumable(cfg) {
		t.Fatal("with no chunks and no file there is nothing to resume")
	}
}
