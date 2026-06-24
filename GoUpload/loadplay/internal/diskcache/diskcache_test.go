package diskcache

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestCache(t *testing.T, maxBytes int64, ttl time.Duration) *Cache {
	t.Helper()
	c, err := New(t.TempDir(), maxBytes, ttl)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

func TestPutGetRoundTrip(t *testing.T) {
	c := newTestCache(t, 1<<20, time.Hour)
	key := "github/owner/repo/main/12_03_2026/abc/segments/0001.ts"
	want := []byte("hello segment bytes")

	if _, ok := c.Get(key); ok {
		t.Fatal("expected miss before Put")
	}
	c.Put(key, want)
	got, ok := c.Get(key)
	if !ok {
		t.Fatal("expected hit after Put")
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	c := newTestCache(t, 1<<20, time.Hour)
	for _, key := range []string{"../escape", "a/../../etc/passwd", ""} {
		c.Put(key, []byte("x"))
		if _, ok := c.Get(key); ok {
			t.Fatalf("traversal key %q should never resolve", key)
		}
	}
	// Nothing should have been written outside the temp root.
	parent := filepath.Dir(c.root)
	if _, err := os.Stat(filepath.Join(parent, "escape")); err == nil {
		t.Fatal("traversal wrote outside root")
	}
}

func TestSweepEvictsExpired(t *testing.T) {
	c := newTestCache(t, 1<<20, 50*time.Millisecond)
	c.Put("a/old.ts", []byte("old"))
	time.Sleep(80 * time.Millisecond)
	c.Put("a/new.ts", []byte("new"))

	c.Sweep()

	if _, ok := c.Get("a/old.ts"); ok {
		t.Fatal("expired entry should be gone")
	}
	if _, ok := c.Get("a/new.ts"); !ok {
		t.Fatal("fresh entry should survive")
	}
}

func TestSweepEnforcesSizeCap(t *testing.T) {
	// Cap of 30 bytes; write three 20-byte entries so the oldest get evicted.
	c := newTestCache(t, 30, time.Hour)
	blob := bytes.Repeat([]byte("x"), 20)

	c.Put("k1.ts", blob)
	time.Sleep(10 * time.Millisecond)
	c.Put("k2.ts", blob)
	time.Sleep(10 * time.Millisecond)
	c.Put("k3.ts", blob)

	c.Sweep()

	st := c.Stats()
	if st.Bytes > 30 {
		t.Fatalf("cache over cap after sweep: %d bytes", st.Bytes)
	}
	if _, ok := c.Get("k3.ts"); !ok {
		t.Fatal("newest entry should survive eviction")
	}
	if _, ok := c.Get("k1.ts"); ok {
		t.Fatal("oldest entry should be evicted first")
	}
}

func TestPutOverwriteIsAtomic(t *testing.T) {
	c := newTestCache(t, 1<<20, time.Hour)
	c.Put("x.ts", []byte("first"))
	c.Put("x.ts", []byte("second"))
	got, ok := c.Get("x.ts")
	if !ok || string(got) != "second" {
		t.Fatalf("overwrite failed: ok=%v got=%q", ok, got)
	}
	// No leftover temp files.
	var tmps int
	_ = filepath.Walk(c.root, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && bytes.Contains([]byte(filepath.Base(p)), []byte(".tmp-")) {
			tmps++
		}
		return nil
	})
	if tmps != 0 {
		t.Fatalf("found %d leftover temp files", tmps)
	}
}
