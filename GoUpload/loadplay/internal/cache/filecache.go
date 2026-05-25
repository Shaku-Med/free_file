package cache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"goupload/loadplay/lib/supabase"
)

// FileMetaFetcher is the upstream lookup surface. *supabase.Client satisfies it.
type FileMetaFetcher interface {
	GetFileMeta(ctx context.Context, uniqueID string) (*supabase.FileMeta, error)
}

// FileCache keeps file metadata in-memory so the DB doesn't get hit
// once per HLS segment. Two TTLs:
//   - hit  → default 15 min (matches signed-in playback token; metadata
//     rarely flips mid-watch)
//   - miss → 30s (404 / not-found; short so legit creates show up quickly)
//
// Concurrent misses for the same id collapse into one upstream call.
type FileCache struct {
	client   FileMetaFetcher
	envRepo  string
	hitTTL   time.Duration
	missTTL  time.Duration
	maxItems int
	onMiss   func(fileID string)

	mu    sync.RWMutex
	items map[string]*entry
	order []string

	flightMu sync.Mutex
	flights  map[string]*flight

	hits      atomic.Uint64
	misses    atomic.Uint64
	upstreams atomic.Uint64
}

type Stats struct {
	Hits      uint64
	Misses    uint64
	Upstreams uint64
	Items     int
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
	Client     FileMetaFetcher
	EnvRepo    string
	HitTTL     time.Duration
	MissTTL    time.Duration
	MaxItems   int
	OnUpstream func(fileID string) // optional; fires on a real Supabase round-trip
}

func New(cfg Config) *FileCache {
	if cfg.HitTTL <= 0 {
		cfg.HitTTL = 15 * time.Minute
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
		onMiss:   cfg.OnUpstream,
		items:    make(map[string]*entry, cfg.MaxItems),
		flights:  make(map[string]*flight),
	}
}

// Stats returns cache counters. Upstreams is the number of Supabase
// round-trips — should stay ~1 per unique_id per hit-TTL window even
// under heavy segment traffic.
func (c *FileCache) Stats() Stats {
	c.mu.RLock()
	items := len(c.items)
	c.mu.RUnlock()
	return Stats{
		Hits:      c.hits.Load(),
		Misses:    c.misses.Load(),
		Upstreams: c.upstreams.Load(),
		Items:     items,
	}
}

// Get returns metadata for the file, hitting Supabase only on a real
// cache miss. Concurrent misses for the same id collapse into one
// upstream call. The repo on the returned meta is the file's own
// `github_repo` if set, otherwise the env fallback.
func (c *FileCache) Get(ctx context.Context, fileID string) (*supabase.FileMeta, error) {
	if hit, ok := c.lookup(fileID); ok {
		c.hits.Add(1)
		if hit == nil {
			return nil, supabase.ErrNotFound
		}
		return cloneMeta(hit), nil
	}

	c.flightMu.Lock()
	fl, busy := c.flights[fileID]
	if !busy {
		fl = &flight{done: make(chan struct{})}
		c.flights[fileID] = fl
	}
	c.flightMu.Unlock()

	if busy {
		select {
		case <-fl.done:
			if errors.Is(fl.err, supabase.ErrNotFound) {
				return nil, supabase.ErrNotFound
			}
			return cloneMeta(fl.meta), fl.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	c.misses.Add(1)
	c.upstreams.Add(1)
	if c.onMiss != nil {
		c.onMiss(fileID)
	}

	meta, err := c.client.GetFileMeta(ctx, fileID)
	if meta != nil && meta.GithubRepo == "" {
		meta.GithubRepo = c.envRepo
	}
	c.store(fileID, meta, err)

	c.flightMu.Lock()
	fl.meta, fl.err = meta, err
	close(fl.done)
	delete(c.flights, fileID)
	c.flightMu.Unlock()

	if errors.Is(err, supabase.ErrNotFound) {
		return nil, supabase.ErrNotFound
	}
	return cloneMeta(meta), err
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

func cloneMeta(m *supabase.FileMeta) *supabase.FileMeta {
	if m == nil {
		return nil
	}
	cp := *m
	return &cp
}
