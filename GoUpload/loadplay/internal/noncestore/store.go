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
	// Distinct client IP prefixes seen for this nonce. Nil until the first
	// CheckIP call so plain Check() users cost nothing extra.
	ips map[string]struct{}
}

// DefaultMaxIPsPerNonce is how many distinct IP prefixes one playback token may
// legitimately appear from.
//
// Exactly one is wrong: the token is minted against the app host and spent
// against the CDN host, and anything assigning egress per connection (iCloud
// Private Relay, CGNAT, VPNs) legitimately shows two or three prefixes for a
// single viewer. Unlimited is also wrong: that is what makes a pasted URL work
// for everyone in a group chat until it expires, which can be six hours.
//
// A small cap separates the two cases cleanly.
const DefaultMaxIPsPerNonce = 3

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
		// CheckIP runs first in the request path and creates the entry with no
		// fingerprint yet. Treat that as unbound and take this one, otherwise
		// every such request would compare against "" and be refused.
		if e.fingerprint == "" {
			e.fingerprint = fingerprint
			s.items[nonce] = e
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

// CheckIP records an IP prefix against a nonce and reports whether the token is
// still within its allowance. A prefix already seen for this nonce always
// passes, so a viewer flipping between two relay exits keeps playing; a new
// prefix past the cap is refused.
//
// Deliberately separate from Check: nonce↔fingerprint stays a strict one-to-one
// binding on browser identity, while the network address gets a small budget.
func (s *Store) CheckIP(nonce, ipPrefix string, max int) bool {
	if nonce == "" || ipPrefix == "" {
		return true
	}
	if max <= 0 {
		max = DefaultMaxIPsPerNonce
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maybeSweep(now)

	e, ok := s.items[nonce]
	if !ok || e.expiresAt.Before(now) {
		if len(s.items) >= s.maxItems {
			s.forceSweepLocked(now)
		}
		s.items[nonce] = entry{
			expiresAt: now.Add(s.ttl),
			ips:       map[string]struct{}{ipPrefix: {}},
		}
		return true
	}

	if e.ips == nil {
		e.ips = make(map[string]struct{}, max)
	}
	if _, seen := e.ips[ipPrefix]; seen {
		s.items[nonce] = e
		return true
	}
	if len(e.ips) >= max {
		return false
	}
	e.ips[ipPrefix] = struct{}{}
	s.items[nonce] = e
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
