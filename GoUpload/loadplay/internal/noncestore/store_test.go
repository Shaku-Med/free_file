package noncestore

import (
	"testing"
	"time"
)

func TestCheck_FirstSightAllowed(t *testing.T) {
	s := New(time.Minute, 100)
	if !s.Check("n1", "fp-a") {
		t.Fatalf("first sight should be allowed")
	}
}

func TestCheck_SameFingerprintAllowed(t *testing.T) {
	s := New(time.Minute, 100)
	s.Check("n1", "fp-a")
	if !s.Check("n1", "fp-a") {
		t.Fatalf("same fingerprint should re-use ok")
	}
}

func TestCheck_DifferentFingerprintRejected(t *testing.T) {
	s := New(time.Minute, 100)
	s.Check("n1", "fp-a")
	if s.Check("n1", "fp-b") {
		t.Fatalf("different fingerprint must be rejected as replay")
	}
}

func TestCheck_EmptyShortCircuits(t *testing.T) {
	s := New(time.Minute, 100)
	if !s.Check("", "fp-a") {
		t.Fatalf("empty nonce should pass")
	}
	if !s.Check("n1", "") {
		t.Fatalf("empty fingerprint should pass")
	}
}

func TestCheck_ExpiredEntryRebinds(t *testing.T) {
	s := New(10*time.Millisecond, 100)
	s.Check("n1", "fp-a")
	time.Sleep(20 * time.Millisecond)
	if !s.Check("n1", "fp-b") {
		t.Fatalf("expired entry should rebind to new fingerprint")
	}
}
