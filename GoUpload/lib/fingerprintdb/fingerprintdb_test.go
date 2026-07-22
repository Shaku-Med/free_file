package fingerprintdb

import (
	"context"
	"math/rand"
	"path/filepath"
	"testing"
)

func makePrints(seed int64, n int) ([]uint32, []int32) {
	r := rand.New(rand.NewSource(seed))
	h := make([]uint32, n)
	o := make([]int32, n)
	for i := 0; i < n; i++ {
		h[i] = r.Uint32()
		o[i] = int32(i)
	}
	return h, o
}

func openTmp(t *testing.T) *DB {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "fp.db"), 0)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestReuploadMatchesOriginal(t *testing.T) {
	db := openTmp(t)
	ctx := context.Background()
	h, o := makePrints(1, 300)

	// First upload: original, stored.
	r1, err := db.Register(ctx, "songAAA", false, h, o, DefaultMinVotes)
	if err != nil {
		t.Fatalf("register orig: %v", err)
	}
	if r1.Matched || !r1.Stored {
		t.Fatalf("first upload should be a stored original, got %+v", r1)
	}

	// Same audio re-uploaded (shifted offsets = same delta) → must match.
	shifted := make([]int32, len(o))
	for i := range o {
		shifted[i] = o[i] + 500
	}
	r2, err := db.Register(ctx, "songBBB", false, h, shifted, DefaultMinVotes)
	if err != nil {
		t.Fatalf("register dup: %v", err)
	}
	if !r2.Matched || r2.OriginalUniqueID != "songAAA" {
		t.Fatalf("re-upload should match songAAA, got %+v", r2)
	}
	if r2.Stored {
		t.Fatalf("a matched sub must not be stored")
	}
}

func TestDifferentSongDoesNotMatch(t *testing.T) {
	db := openTmp(t)
	ctx := context.Background()
	h1, o1 := makePrints(1, 300)
	if _, err := db.Register(ctx, "songAAA", false, h1, o1, DefaultMinVotes); err != nil {
		t.Fatalf("register orig: %v", err)
	}
	h2, o2 := makePrints(999, 300) // unrelated
	r, err := db.Register(ctx, "songCCC", false, h2, o2, DefaultMinVotes)
	if err != nil {
		t.Fatalf("register other: %v", err)
	}
	if r.Matched {
		t.Fatalf("unrelated song must not match, got %+v", r)
	}
	if !r.Stored {
		t.Fatalf("unrelated original should be stored")
	}
}

func TestReelMatchesButIsNotStored(t *testing.T) {
	db := openTmp(t)
	ctx := context.Background()
	h, o := makePrints(1, 300)
	if _, err := db.Register(ctx, "songAAA", false, h, o, DefaultMinVotes); err != nil {
		t.Fatalf("register orig: %v", err)
	}
	// A reel using the same audio: links to the original, never stored.
	r, err := db.Register(ctx, "reel001", true, h, o, DefaultMinVotes)
	if err != nil {
		t.Fatalf("register reel: %v", err)
	}
	if !r.Matched || r.OriginalUniqueID != "songAAA" || r.Stored {
		t.Fatalf("reel should match+link but not store, got %+v", r)
	}
	// An original reel (no match) must NOT be stored either.
	h2, o2 := makePrints(42, 300)
	r2, err := db.Register(ctx, "reel002", true, h2, o2, DefaultMinVotes)
	if err != nil {
		t.Fatalf("register reel2: %v", err)
	}
	if r2.Matched || r2.Stored {
		t.Fatalf("unmatched reel must not be stored, got %+v", r2)
	}
	n, _ := db.Count(ctx)
	if n != 300 {
		t.Fatalf("only the one original should be stored, got %d rows", n)
	}
}

func TestInjectionSafeUniqueID(t *testing.T) {
	db := openTmp(t)
	ctx := context.Background()
	h, o := makePrints(1, 40)
	_, err := db.Register(ctx, "'; DROP TABLE audio_fingerprints;--", false, h, o, DefaultMinVotes)
	if err == nil {
		t.Fatalf("malicious unique_id must be rejected")
	}
	// Table must still exist and be usable.
	if _, err := db.Count(ctx); err != nil {
		t.Fatalf("table should be intact: %v", err)
	}
}
