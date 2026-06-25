package token

import (
	"strings"
	"testing"
	"time"
)

var testSecret = []byte("test-shared-secret-must-be-long-enough")

func validPayload() Playback {
	return Playback{
		FileID: "file-123",
		UserID: "user-abc",
		Path:   "19_05_2026/abc/master.m3u8",
		Exp:    time.Now().Add(5 * time.Minute).UnixMilli(),
	}
}

func TestRoundTrip(t *testing.T) {
	p := validPayload()
	raw, err := Encode(p, testSecret)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := Verify(raw, testSecret)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got.FileID != p.FileID || got.Path != p.Path {
		t.Fatalf("mismatch: %+v vs %+v", got, p)
	}
}

func TestCastClaimRoundTrips(t *testing.T) {
	p := validPayload()
	if p.IsCast() {
		t.Fatal("default token should not be cast")
	}
	p.Cast = 1
	raw, err := Encode(p, testSecret)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := Verify(raw, testSecret)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !got.IsCast() {
		t.Fatal("expected IsCast() true for cast token")
	}
}

func TestWrongSecretRejected(t *testing.T) {
	raw, _ := Encode(validPayload(), testSecret)
	if _, err := Verify(raw, []byte("different-secret")); err != ErrBadSignature {
		t.Fatalf("expected ErrBadSignature, got %v", err)
	}
}

func TestTamperedPayloadRejected(t *testing.T) {
	raw, _ := Encode(validPayload(), testSecret)
	// Flip a byte in the payload half; signature still matches the old payload
	// so verifying against the new payload bytes must fail.
	parts := strings.SplitN(raw, ".", 2)
	tampered := parts[0][:len(parts[0])-2] + "AA" + "." + parts[1]
	if _, err := Verify(tampered, testSecret); err == nil {
		t.Fatal("expected verification failure on tampered payload")
	}
}

func TestExpiredRejected(t *testing.T) {
	p := validPayload()
	p.Exp = time.Now().Add(-1 * time.Second).UnixMilli()
	raw, _ := Encode(p, testSecret)
	if _, err := Verify(raw, testSecret); err != ErrExpired {
		t.Fatalf("expected ErrExpired, got %v", err)
	}
}

func TestMalformedRejected(t *testing.T) {
	cases := []string{"", "no-dot", "....", "only-half."}
	for _, c := range cases {
		if _, err := Verify(c, testSecret); err == nil {
			t.Fatalf("expected error for %q", c)
		}
	}
}
