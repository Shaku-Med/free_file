package ratelimit

import (
	"testing"
	"time"
)

// A ripper pulls flat out. It should get its burst and then be cut to the
// refill rate, rather than sailing through at the old 3.3/s ceiling.
func TestPaceThrottlesSustainedPull(t *testing.T) {
	l := New()
	allowed := 0
	for i := 0; i < 200; i++ {
		if l.AllowSegment("ripper") {
			allowed++
		}
	}
	if allowed > int(paceBurst) {
		t.Fatalf("burst not enforced: %d segments allowed instantly, want <= %d",
			allowed, int(paceBurst))
	}
	if allowed < int(paceBurst)-1 {
		t.Fatalf("burst too small: only %d allowed, want ~%d", allowed, int(paceBurst))
	}
}

// The opening buffer fill must never stall  a fresh session starts full.
func TestPaceAllowsStartupBurst(t *testing.T) {
	l := New()
	for i := 0; i < 30; i++ {
		if !l.AllowSegment("viewer") {
			t.Fatalf("startup segment %d refused; playback would stall", i)
		}
	}
}

// A real viewer: ~0.33 segments/sec sustained. Simulated by draining the burst
// then feeding requests at real-time pace. None may be refused.
func TestPaceAllowsRealViewer(t *testing.T) {
	l := New()
	b := &paceBucket{tokens: 0, lastSeen: time.Now().Add(-1 * time.Second)}
	l.pace["viewer"] = b

	// One segment every 3s is a viewer pulling video+audio at 6s segments.
	now := time.Now()
	for i := 0; i < 50; i++ {
		now = now.Add(3 * time.Second)
		b.lastSeen = now.Add(-3 * time.Second)
		elapsed := 3.0
		b.tokens += elapsed * paceRefill
		if b.tokens > paceBurst {
			b.tokens = paceBurst
		}
		if b.tokens < 1 {
			t.Fatalf("real-time viewer throttled at request %d", i)
		}
		b.tokens--
	}
}

// Tokens refill over time, so a throttled client recovers rather than being
// locked out for the rest of the session.
// Exercises allowPace directly: AllowSegment also consults the sliding-window
// ceiling, which would mask the refill behaviour under test here.
func TestPaceRefills(t *testing.T) {
	l := New()
	for i := 0; i < 200; i++ {
		l.allowPace("k")
	}
	if l.allowPace("k") {
		t.Fatal("expected to be throttled after draining the bucket")
	}
	// Rewind lastSeen to simulate 10s passing: 10 tokens back.
	l.pace["k"].lastSeen = time.Now().Add(-10 * time.Second)
	for i := 0; i < 9; i++ {
		if !l.allowPace("k") {
			t.Fatalf("refill did not restore capacity at %d", i)
		}
	}
}

// Idle buckets are reclaimed so the map cannot grow without bound.
func TestPaceSweepReclaimsIdle(t *testing.T) {
	l := New()
	l.AllowSegment("old")
	l.pace["old"].lastSeen = time.Now().Add(-10 * time.Minute)
	l.lastPaceSweepAt = time.Now().Add(-2 * sweepInterval)

	l.AllowSegment("new")
	if _, ok := l.pace["old"]; ok {
		t.Fatal("idle pace bucket was not swept")
	}
}

// Pace is per-key, so one client being throttled cannot affect another.
func TestPaceIsolatesKeys(t *testing.T) {
	l := New()
	for i := 0; i < 200; i++ {
		l.AllowSegment("noisy")
	}
	if !l.AllowSegment("quiet") {
		t.Fatal("one client's throttling leaked into another's bucket")
	}
}
