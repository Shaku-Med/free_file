package cache

import (
	"context"
	"errors"
	"sync"
	"time"

	"goupload/loadplay/lib/supabase"
)

// FileCache keeps file metadata in-memory so the DB doesn't get hit
// once per HLS segment. Two TTLs:
//   - hit  → 5 min (file existence + access flags rarely flip mid-watch)
//   - miss → 30s (404 / not-found; short so legit creates show up quickly)
// A simple FIFO eviction caps memory; access patterns are mostly
// short-lived per-video so LRU isn't worth the extra book-keeping.
type FileCache struct {
	client   *supabase.Client
	envRepo  string
	hitTTL   time.Duration
	missTTL  time.Duration
	maxItems int

	mu    sync.RWMutex
	items map[string]*entry
	order []string

	// In-flight dedup — if 100 segments for the same file race in
	// uncached, only ONE Supabase request fires; the others wait.
	flightMu sync.Mutex
	flights  map[string]*flight
}

type entry struct {
	meta *supabase.FileMeta // nil when negative-cached
	exp  time.Time
}

type flight struct {
	done chan struct{}
	meta *supabase.FileMeta
	err  error
}

type Config struct {
	Client     *supabase.Client
	EnvRepo    string
	HitTTL     time.Duration
	MissTTL    time.Duration
	MaxItems   int
}

func New(cfg Config) *FileCache {
	if cfg.HitTTL <= 0 {
		cfg.HitTTL = 5 * time.Minute
	}
	if cfg.MissTTL <= 0 {
		cfg.MissTTL = 30 * time.Second
	}
	if cfg.MaxItems <= 0 {
		cfg.MaxItems = 5000
	}
	return &FileCache{
		client:   cfg.Client,
		envRepo:  cfg.EnvRepo,
		hitTTL:   cfg.HitTTL,
		missTTL:  cfg.MissTTL,
		maxItems: cfg.MaxItems,
		items:    make(map[string]*entry, cfg.MaxItems),
		flights:  make(map[string]*flight),
	}
}

// Get returns metadata for the file, hitting Supabase only on a real
// cache miss. Concurrent misses for the same id collapse into one
// upstream call. The repo on the returned meta is the file's own
// `github_repo` if set, otherwise the env fallback.
func (c *FileCache) Get(ctx context.Context, fileID string) (*supabase.FileMeta, error) {
	if hit, ok := c.lookup(fileID); ok {
		if hit == nil {
			return nil, supabase.ErrNotFound
		}
		return hit, nil
	}

	c.flightMu.Lock()
	fl, busy := c.flights[fileID]
	if !busy {
		fl = &flight{done: make(chan struct{})}
		c.flights[fileID] = fl
	}
	c.flightMu.Unlock()

	if busy {
		// Another goroutine already firing — wait, then read its result.
		select {
		case <-fl.done:
			if errors.Is(fl.err, supabase.ErrNotFound) {
				return nil, supabase.ErrNotFound
			}
			return fl.meta, fl.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	meta, err := c.client.GetFileMeta(ctx, fileID)
	// Apply env fallback before caching so consumers don't have to.
	if meta != nil && meta.GithubRepo == "" {
		meta.GithubRepo = c.envRepo
	}
	c.store(fileID, meta, err)

	// Hand the result to any waiters and clear the flight.
	c.flightMu.Lock()
	fl.meta, fl.err = meta, err
	close(fl.done)
	delete(c.flights, fileID)
	c.flightMu.Unlock()

	if errors.Is(err, supabase.ErrNotFound) {
		return nil, supabase.ErrNotFound
	}
	return meta, err
}

func (c *FileCache) lookup(fileID string) (*supabase.FileMeta, bool) {
	c.mu.RLock()
	e, ok := c.items[fileID]
	c.mu.RUnlock()
	if !ok {
		return nil, false
	}
	if time.Now().After(e.exp) {
		// Lazily evict on read; safe because cache is best-effort.
		c.mu.Lock()
		if cur, still := c.items[fileID]; still && cur == e {
			delete(c.items, fileID)
		}
		c.mu.Unlock()
		return nil, false
	}
	return e.meta, true
}

func (c *FileCache) store(fileID string, meta *supabase.FileMeta, err error) {
	// Only cache "found" or "not found" — transient errors (network /
	// 5xx) should not be remembered, otherwise a brief upstream blip
	// poisons the cache for the whole TTL window.
	var e *entry
	switch {
	case errors.Is(err, supabase.ErrNotFound):
		e = &entry{meta: nil, exp: time.Now().Add(c.missTTL)}
	case err == nil && meta != nil:
		e = &entry{meta: meta, exp: time.Now().Add(c.hitTTL)}
	default:
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, existed := c.items[fileID]; !existed {
		c.order = append(c.order, fileID)
	}
	c.items[fileID] = e
	// FIFO eviction. Cheap O(1) trim.
	for len(c.items) > c.maxItems && len(c.order) > 0 {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.items, oldest)
	}
}
