package ratelimit

import (
	"sync"
	"time"
)

// Mirrors app SegmentRateLimiter  in-memory sliding windows per key.
// Segment cap raised for separate audio: video + audio segments share one
// per-file bucket, so a normal viewer now pulls ~2x the segments (plus bursts
// on seek/scrub). Manifest cap nudged up for the extra audio child playlist.
//
// The sliding window is now only the ABSOLUTE CEILING. Sustained throughput is
// governed by the token bucket below.
const (
	segmentWindow  = 45 * time.Second
	segmentMax     = 150
	manifestWindow = 60 * time.Second
	manifestMax    = 30
	sweepInterval  = 60 * time.Second
)

// Pace control.
//
// A flat 150/45s window is 3.3 segments/sec sustained, and a real viewer needs
// about 0.33/s (video + audio at ~6s segments). That gap let a ripper pull an
// entire video at ~10x real time and still look "within the limit"  which is
// exactly what a header-replaying downloader does.
//
// A token bucket separates the two shapes of traffic. Legit playback is bursty
// but LOW AVERAGE: a startup buffer, then long quiet stretches, then a spike on
// each seek. Ripping is a flat-out sustained pull. So: a generous burst so
// startup and heavy scrubbing never stall, and a refill rate near real time so
// sustained extraction can't outrun playback by much.
//
//	paceBurst   60 segments  startup prefetch plus roughly a dozen seeks
//	paceRefill  1.0 seg/sec  ~3x a real viewer's need; still 3x tighter than
//	                          the old sustained ceiling
//
// This is friction, not prevention  see docs/Playback-Security.md. It cannot
// stop a downloader that paces itself, and nothing short of DRM can.
const (
	paceBurst  = 60.0
	paceRefill = 1.0
)

type Limiter struct {
	mu          sync.Mutex
	segments    map[string]*bucket
	manifests   map[string]*bucket
	pace            map[string]*paceBucket
	lastSweepAt     time.Time
	lastPaceSweepAt time.Time
}

type bucket struct {
	times []time.Time
}

// paceBucket is a classic token bucket: `tokens` refills at paceRefill per
// second up to paceBurst, and each segment costs one.
type paceBucket struct {
	tokens   float64
	lastSeen time.Time
}

func New() *Limiter {
	return &Limiter{
		segments:  make(map[string]*bucket),
		manifests: make(map[string]*bucket),
		pace:      make(map[string]*paceBucket),
	}
}

// AllowSegment applies the absolute ceiling first, then the pace bucket.
// Both must permit the request.
func (l *Limiter) AllowSegment(key string) bool {
	if !l.allow(l.segments, segmentWindow, segmentMax, key) {
		return false
	}
	return l.allowPace(key)
}

func (l *Limiter) allowPace(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	l.sweepPaceLocked(now)

	b := l.pace[key]
	if b == nil {
		// A fresh session starts with a full burst so the opening buffer fill
		// is never throttled.
		l.pace[key] = &paceBucket{tokens: paceBurst - 1, lastSeen: now}
		return true
	}

	elapsed := now.Sub(b.lastSeen).Seconds()
	b.lastSeen = now
	b.tokens += elapsed * paceRefill
	if b.tokens > paceBurst {
		b.tokens = paceBurst
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
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

// sweepPaceLocked drops buckets that have been idle long enough to have fully
// refilled. Such a bucket is indistinguishable from a fresh one, so deleting it
// changes no decision and keeps the map from growing without bound.
// Caller must hold l.mu.
func (l *Limiter) sweepPaceLocked(now time.Time) {
	if now.Sub(l.lastPaceSweepAt) < sweepInterval {
		return
	}
	l.lastPaceSweepAt = now
	idle := time.Duration(paceBurst/paceRefill) * time.Second
	for k, b := range l.pace {
		if now.Sub(b.lastSeen) >= idle {
			delete(l.pace, k)
		}
	}
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
