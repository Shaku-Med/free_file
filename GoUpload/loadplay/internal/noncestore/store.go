package noncestore

import (
	"sync"
	"time"
)

// Store binds a token nonce to the first fingerprint that used it.
// Subsequent requests carrying the same nonce from a different
// fingerprint are rejected as replay attempts (token sharing /
// stolen URL pasted into a second browser).
//
// In-memory only. Single-instance LoadPlay deployment is fine; if
// you ever scale horizontally, swap for Redis (same API).
type Store struct {
	mu          sync.Mutex
	items       map[string]entry
	ttl         time.Duration
	lastSweepAt time.Time
	sweepEvery  time.Duration
	maxItems    int
}

type entry struct {
	fingerprint string
	expiresAt   time.Time
}

func New(ttl time.Duration, maxItems int) *Store {
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	if maxItems <= 0 {
		maxItems = 50_000
	}
	return &Store{
		items:      make(map[string]entry),
		ttl:        ttl,
		sweepEvery: 5 * time.Minute,
		maxItems:   maxItems,
	}
}

// Check records (nonce, fingerprint) on first sight. Returns false if
// the same nonce has already been used by a different fingerprint.
// Empty nonce or fingerprint short-circuits to allow (nothing to bind).
func (s *Store) Check(nonce, fingerprint string) bool {
	if nonce == "" || fingerprint == "" {
		return true
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maybeSweep(now)

	if e, ok := s.items[nonce]; ok {
		if e.expiresAt.Before(now) {
			s.items[nonce] = entry{fingerprint: fingerprint, expiresAt: now.Add(s.ttl)}
			return true
		}
		return e.fingerprint == fingerprint
	}

	// Pressure relief: if we're over the cap, drop oldest sweep before
	// admitting more. Cheap because sweep removes expired entries.
	if len(s.items) >= s.maxItems {
		s.forceSweepLocked(now)
	}
	s.items[nonce] = entry{fingerprint: fingerprint, expiresAt: now.Add(s.ttl)}
	return true
}

func (s *Store) maybeSweep(now time.Time) {
	if now.Sub(s.lastSweepAt) < s.sweepEvery {
		return
	}
	s.forceSweepLocked(now)
}

func (s *Store) forceSweepLocked(now time.Time) {
	s.lastSweepAt = now
	for k, e := range s.items {
		if e.expiresAt.Before(now) {
			delete(s.items, k)
		}
	}
}
