package noncestore

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// A viewer behind a rotating relay shows a few prefixes and must keep playing.
func TestRelayRotationWithinBudgetIsAllowed(t *testing.T) {
	s := New(30*time.Minute, 1000)
	for i, ip := range []string{"146.75.203.0", "146.75.44.0", "104.28.11.0"} {
		if !s.CheckIP("nonce-a", ip, 3) {
			t.Fatalf("prefix %d (%s) refused inside the budget", i+1, ip)
		}
	}
	// Returning to an address already seen must always pass, even at the cap.
	if !s.CheckIP("nonce-a", "146.75.203.0", 3) {
		t.Fatal("a previously seen prefix was refused")
	}
}

// A URL pasted around shows many prefixes and must stop working.
func TestSpreadBeyondBudgetIsRefused(t *testing.T) {
	s := New(30*time.Minute, 1000)
	for i := 0; i < 3; i++ {
		if !s.CheckIP("nonce-b", fmt.Sprintf("10.0.%d.0", i), 3) {
			t.Fatalf("prefix %d refused inside the budget", i)
		}
	}
	for i := 3; i < 8; i++ {
		if s.CheckIP("nonce-b", fmt.Sprintf("10.0.%d.0", i), 3) {
			t.Fatalf("prefix %d admitted past the budget", i)
		}
	}
}

// Budgets must not bleed between tokens.
func TestBudgetIsPerNonce(t *testing.T) {
	s := New(30*time.Minute, 1000)
	for i := 0; i < 3; i++ {
		s.CheckIP("nonce-c", fmt.Sprintf("10.1.%d.0", i), 3)
	}
	if s.CheckIP("nonce-c", "10.1.9.0", 3) {
		t.Fatal("nonce-c should be exhausted")
	}
	if !s.CheckIP("nonce-d", "10.1.9.0", 3) {
		t.Fatal("a different nonce was charged for nonce-c's spread")
	}
}

// An expired entry starts a fresh budget rather than staying exhausted.
func TestExpiryResetsTheBudget(t *testing.T) {
	s := New(20*time.Millisecond, 1000)
	for i := 0; i < 3; i++ {
		s.CheckIP("nonce-e", fmt.Sprintf("10.2.%d.0", i), 3)
	}
	if s.CheckIP("nonce-e", "10.2.9.0", 3) {
		t.Fatal("expected exhaustion before expiry")
	}
	time.Sleep(40 * time.Millisecond)
	if !s.CheckIP("nonce-e", "10.2.9.0", 3) {
		t.Fatal("budget did not reset after the entry expired")
	}
}

// Missing values must not become a silent bypass of the surrounding checks.
func TestEmptyInputsAllowWithoutRecording(t *testing.T) {
	s := New(30*time.Minute, 1000)
	if !s.CheckIP("", "10.3.0.0", 3) || !s.CheckIP("nonce-f", "", 3) {
		t.Fatal("empty inputs should short-circuit to allow")
	}
	if len(s.items) != 0 {
		t.Fatalf("empty inputs recorded state: %d entries", len(s.items))
	}
}

// CheckIP and Check share the map, so they must not corrupt each other.
func TestConcurrentUseIsRaceFree(t *testing.T) {
	s := New(30*time.Minute, 1000)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s.CheckIP("shared", fmt.Sprintf("10.4.%d.0", i%4), 3)
			s.Check("shared-fp", "fingerprint")
		}(i)
	}
	wg.Wait()
}

// Reproduces the ordering bug: softGuardOrFingerprint calls CheckIP before
// enforcePlaybackSecurity calls Check, so the entry exists with no fingerprint
// yet. Check must adopt it, not compare against "" and refuse.
func TestCheckIPBeforeCheckDoesNotLockOutTheViewer(t *testing.T) {
	s := New(30*time.Minute, 1000)

	if !s.CheckIP("nonce-order", "146.75.203.0", 3) {
		t.Fatal("first CheckIP refused")
	}
	if !s.Check("nonce-order", "ua|shape") {
		t.Fatal("Check refused a nonce that only CheckIP had touched")
	}
	// The fingerprint is bound now, so a different one is still rejected.
	if s.Check("nonce-order", "other-ua|shape") {
		t.Fatal("a second fingerprint was accepted after binding")
	}
}
