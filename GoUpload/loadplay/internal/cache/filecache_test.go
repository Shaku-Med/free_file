package cache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"goupload/loadplay/lib/supabase"
)

type stubFetcher struct {
	calls atomic.Int32
	meta  *supabase.FileMeta
	err   error
	delay time.Duration
}

func (s *stubFetcher) GetFileMeta(ctx context.Context, _ string) (*supabase.FileMeta, error) {
	s.calls.Add(1)
	if s.delay > 0 {
		select {
		case <-time.After(s.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if s.err != nil {
		return nil, s.err
	}
	return s.meta, nil
}

func TestFileCacheHitAvoidsUpstream(t *testing.T) {
	fetcher := &stubFetcher{
		meta: &supabase.FileMeta{ID: "uuid-1", IsPublic: true, GithubRepo: "repo-a"},
	}
	c := New(Config{Client: fetcher, EnvRepo: "fallback", HitTTL: time.Minute})

	ctx := context.Background()
	for i := 0; i < 50; i++ {
		meta, err := c.Get(ctx, "file-abc")
		if err != nil {
			t.Fatalf("get %d: %v", i, err)
		}
		if meta.GithubRepo != "repo-a" {
			t.Fatalf("unexpected repo: %q", meta.GithubRepo)
		}
	}

	if got := fetcher.calls.Load(); got != 1 {
		t.Fatalf("upstream calls = %d, want 1", got)
	}
	st := c.Stats()
	if st.Hits != 49 || st.Misses != 1 || st.Upstreams != 1 {
		t.Fatalf("stats = %+v, want hits=49 misses=1 upstreams=1", st)
	}
}

func TestFileCacheConcurrentMissDedupes(t *testing.T) {
	fetcher := &stubFetcher{
		meta:  &supabase.FileMeta{ID: "uuid-1", IsPublic: true},
		delay: 50 * time.Millisecond,
	}
	c := New(Config{Client: fetcher, HitTTL: time.Minute})

	const workers = 32
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			_, err := c.Get(context.Background(), "same-file")
			if err != nil {
				t.Errorf("get: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := fetcher.calls.Load(); got != 1 {
		t.Fatalf("upstream calls = %d, want 1", got)
	}
	if st := c.Stats(); st.Upstreams != 1 {
		t.Fatalf("upstreams = %d, want 1", st.Upstreams)
	}
}

func TestFileCacheNegativeCached(t *testing.T) {
	fetcher := &stubFetcher{err: supabase.ErrNotFound}
	c := New(Config{Client: fetcher, MissTTL: time.Minute})

	ctx := context.Background()
	for i := 0; i < 5; i++ {
		_, err := c.Get(ctx, "missing")
		if !errors.Is(err, supabase.ErrNotFound) {
			t.Fatalf("get %d: want ErrNotFound, got %v", i, err)
		}
	}
	if fetcher.calls.Load() != 1 {
		t.Fatalf("upstream calls = %d, want 1", fetcher.calls.Load())
	}
}

func TestFileCacheTransientErrorNotCached(t *testing.T) {
	fetcher := &stubFetcher{err: errors.New("supabase 503")}
	c := New(Config{Client: fetcher, HitTTL: time.Minute})

	ctx := context.Background()
	_, err := c.Get(ctx, "flaky")
	if err == nil {
		t.Fatal("expected error")
	}
	_, err = c.Get(ctx, "flaky")
	if err == nil {
		t.Fatal("expected error on retry")
	}
	if fetcher.calls.Load() != 2 {
		t.Fatalf("upstream calls = %d, want 2 (no poison cache)", fetcher.calls.Load())
	}
}

func TestFileCacheEnvRepoFallback(t *testing.T) {
	fetcher := &stubFetcher{meta: &supabase.FileMeta{ID: "uuid-1", IsPublic: true}}
	c := New(Config{Client: fetcher, EnvRepo: "default-repo", HitTTL: time.Minute})

	meta, err := c.Get(context.Background(), "file-x")
	if err != nil {
		t.Fatal(err)
	}
	if meta.GithubRepo != "default-repo" {
		t.Fatalf("repo = %q, want default-repo", meta.GithubRepo)
	}
}
