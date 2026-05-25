package manifestcache

import (
	"sync"
	"time"
)

// Cache stores raw manifest bodies keyed by `repo|path`. Manifests for
// finished uploads are immutable — caching them for a minute eliminates
// nearly all upstream GitHub fetches under hot-video load. The rewritten
// (token-stamped) body is NOT cached because the token rotates per
// session; we cache the raw body and rewrite per request (cheap).
//
// Singleflight is built in: concurrent misses for the same key wait on
// the first fetch instead of stampeding GitHub.
type Cache struct {
	ttl      time.Duration
	maxItems int

	mu    sync.RWMutex
	items map[string]entry
	order []string

	flightMu sync.Mutex
	flights  map[string]*flight
}

type entry struct {
	body []byte
	exp  time.Time
}

type flight struct {
	done chan struct{}
	body []byte
	err  error
}

func New(ttl time.Duration, maxItems int) *Cache {
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	if maxItems <= 0 {
		maxItems = 2000
	}
	return &Cache{
		ttl:      ttl,
		maxItems: maxItems,
		items:    make(map[string]entry, maxItems),
		flights:  make(map[string]*flight),
	}
}

// Get returns a cached body. ok=false means caller should fetch and
// then call Set / Singleflight to fill.
func (c *Cache) Get(key string) (string, bool) {
	c.mu.RLock()
	e, ok := c.items[key]
	c.mu.RUnlock()
	if !ok {
		return "", false
	}
	if time.Now().After(e.exp) {
		return "", false
	}
	return string(e.body), true
}

func (c *Cache) Set(key string, body string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, existed := c.items[key]; !existed {
		c.order = append(c.order, key)
	}
	c.items[key] = entry{body: []byte(body), exp: time.Now().Add(c.ttl)}
	for len(c.items) > c.maxItems && len(c.order) > 0 {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.items, oldest)
	}
}

// Do is the singleflight wrapper. fn runs at most once per key per
// in-flight wave; concurrent callers wait and share the result.
func (c *Cache) Do(key string, fn func() (string, error)) (string, error) {
	if v, ok := c.Get(key); ok {
		return v, nil
	}
	c.flightMu.Lock()
	fl, busy := c.flights[key]
	if !busy {
		fl = &flight{done: make(chan struct{})}
		c.flights[key] = fl
	}
	c.flightMu.Unlock()

	if busy {
		<-fl.done
		return string(fl.body), fl.err
	}

	body, err := fn()
	if err == nil {
		c.Set(key, body)
	}
	c.flightMu.Lock()
	fl.body, fl.err = []byte(body), err
	close(fl.done)
	delete(c.flights, key)
	c.flightMu.Unlock()
	return body, err
}
