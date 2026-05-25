package ratelimit

import (
	"sync"
	"time"
)

// Mirrors app SegmentRateLimiter  in-memory sliding windows per key.
const (
	segmentWindow    = 45 * time.Second
	segmentMax       = 70
	manifestWindow   = 60 * time.Second
	manifestMax      = 22
	sweepInterval    = 60 * time.Second
)

type Limiter struct {
	mu          sync.Mutex
	segments    map[string]*bucket
	manifests   map[string]*bucket
	lastSweepAt time.Time
}

type bucket struct {
	times []time.Time
}

func New() *Limiter {
	return &Limiter{
		segments:  make(map[string]*bucket),
		manifests: make(map[string]*bucket),
	}
}

func (l *Limiter) AllowSegment(key string) bool {
	return l.allow(l.segments, segmentWindow, segmentMax, key)
}

func (l *Limiter) AllowManifest(key string) bool {
	return l.allow(l.manifests, manifestWindow, manifestMax, key)
}

func (l *Limiter) SegmentRetryAfter(key string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.segments[key]
	if b == nil || len(b.times) == 0 {
		return 1
	}
	oldest := b.times[0]
	sec := int(time.Until(oldest.Add(segmentWindow)).Seconds())
	if sec < 1 {
		return 1
	}
	return sec
}

func (l *Limiter) allow(store map[string]*bucket, window time.Duration, max int, key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(now, store, window)
	b := store[key]
	if b == nil {
		b = &bucket{}
		store[key] = b
	}
	cutoff := now.Add(-window)
	filtered := b.times[:0]
	for _, t := range b.times {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}
	b.times = filtered
	if len(b.times) >= max {
		return false
	}
	b.times = append(b.times, now)
	return true
}

func (l *Limiter) sweep(now time.Time, store map[string]*bucket, window time.Duration) {
	if now.Sub(l.lastSweepAt) < sweepInterval {
		return
	}
	l.lastSweepAt = now
	cutoff := now.Add(-window)
	for k, b := range store {
		filtered := b.times[:0]
		for _, t := range b.times {
			if t.After(cutoff) {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) == 0 {
			delete(store, k)
		} else {
			b.times = filtered
		}
	}
}
