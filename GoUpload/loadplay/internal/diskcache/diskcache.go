// Package diskcache is an on-disk byte cache for upstream storage objects
// (HLS segments and init files). Keys mirror the upstream folder layout so the
// tree is easy to inspect. Entries expire by age and the total footprint is
// capped; a janitor enforces both on a timer.
package diskcache

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Cache struct {
	root     string
	maxBytes int64
	ttl      time.Duration

	hits   atomic.Uint64
	misses atomic.Uint64
	writes atomic.Uint64

	seqMu sync.Mutex
	seq   uint64
}

type Stats struct {
	Hits, Misses, Writes uint64
	Bytes                int64
	Items                int
}

func New(root string, maxBytes int64, ttl time.Duration) (*Cache, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("diskcache: empty root")
	}
	if maxBytes <= 0 {
		maxBytes = 20 << 30
	}
	if ttl <= 0 {
		ttl = time.Hour
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, err
	}
	return &Cache{root: abs, maxBytes: maxBytes, ttl: ttl}, nil
}

// resolve maps a key to an absolute path under root and refuses anything that
// would escape root. Keys are built server-side, this is defense in depth.
func (c *Cache) resolve(key string) (string, bool) {
	if key == "" {
		return "", false
	}
	// Reject any parent-dir component outright. Keys are server-built and
	// must never contain "..".
	for _, part := range strings.Split(key, "/") {
		if part == ".." {
			return "", false
		}
	}
	full := filepath.Join(c.root, filepath.Clean("/"+filepath.FromSlash(key)))
	if full != c.root && !strings.HasPrefix(full, c.root+string(os.PathSeparator)) {
		return "", false
	}
	return full, true
}

func (c *Cache) Get(key string) ([]byte, bool) {
	full, ok := c.resolve(key)
	if !ok {
		return nil, false
	}
	data, err := os.ReadFile(full)
	if err != nil {
		c.misses.Add(1)
		return nil, false
	}
	c.hits.Add(1)
	return data, true
}

// Put writes atomically (temp file then rename) so readers never see a partial
// object. Failures are swallowed: the cache is best effort.
func (c *Cache) Put(key string, data []byte) {
	full, ok := c.resolve(key)
	if !ok {
		return
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return
	}
	c.seqMu.Lock()
	c.seq++
	seq := c.seq
	c.seqMu.Unlock()

	tmp := fmt.Sprintf("%s.tmp-%d-%d", full, os.Getpid(), seq)
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		_ = os.Remove(tmp)
		return
	}
	if err := os.Rename(tmp, full); err != nil {
		_ = os.Remove(tmp)
		return
	}
	c.writes.Add(1)
}

type fileMeta struct {
	path string
	size int64
	mod  time.Time
}

// Sweep deletes entries older than the TTL, then evicts the oldest entries
// until the total footprint is under the cap. Stale temp files are cleaned too.
func (c *Cache) Sweep() {
	cutoff := time.Now().Add(-c.ttl)
	var kept []fileMeta
	var total int64

	_ = filepath.Walk(c.root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if strings.Contains(filepath.Base(p), ".tmp-") {
			if info.ModTime().Before(cutoff) {
				_ = os.Remove(p)
			}
			return nil
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(p)
			return nil
		}
		total += info.Size()
		kept = append(kept, fileMeta{p, info.Size(), info.ModTime()})
		return nil
	})

	if total > c.maxBytes {
		sort.Slice(kept, func(i, j int) bool { return kept[i].mod.Before(kept[j].mod) })
		for _, f := range kept {
			if total <= c.maxBytes {
				break
			}
			if os.Remove(f.path) == nil {
				total -= f.size
			}
		}
	}
	c.pruneEmptyDirs()
}

func (c *Cache) pruneEmptyDirs() {
	var dirs []string
	_ = filepath.Walk(c.root, func(p string, info os.FileInfo, err error) error {
		if err == nil && info.IsDir() && p != c.root {
			dirs = append(dirs, p)
		}
		return nil
	})
	for i := len(dirs) - 1; i >= 0; i-- {
		_ = os.Remove(dirs[i]) // only succeeds when empty
	}
}

// StartJanitor runs Sweep on a ticker until the returned stop func is called.
func (c *Cache) StartJanitor(interval time.Duration) (stop func()) {
	if interval <= 0 {
		interval = time.Hour
	}
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				c.Sweep()
			}
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(done) }) }
}

func (c *Cache) Stats() Stats {
	var total int64
	var items int
	_ = filepath.Walk(c.root, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			total += info.Size()
			items++
		}
		return nil
	})
	return Stats{
		Hits:   c.hits.Load(),
		Misses: c.misses.Load(),
		Writes: c.writes.Load(),
		Bytes:  total,
		Items:  items,
	}
}
