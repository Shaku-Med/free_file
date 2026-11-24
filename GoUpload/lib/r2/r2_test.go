package r2

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// AWS-published "derive a signing key" vector. Validates the HMAC chain and
// hashing primitives the signer relies on. service here is "iam" to match the
// published example.
func TestSigningKeyVector(t *testing.T) {
	secret := "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"
	want := "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"

	kDate := hmacSHA256([]byte("AWS4"+secret), []byte("20120215"))
	kRegion := hmacSHA256(kDate, []byte("us-east-1"))
	kService := hmacSHA256(kRegion, []byte("iam"))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))

	if got := hex.EncodeToString(kSigning); got != want {
		t.Fatalf("signing key mismatch:\n got=%s\nwant=%s", got, want)
	}
}

func TestURIEncode(t *testing.T) {
	if got := uriEncode("a b/c~d", false); got != "a%20b/c~d" {
		t.Fatalf("keep-slash encode: %s", got)
	}
	if got := uriEncode("a b/c~d", true); got != "a%20b%2Fc~d" {
		t.Fatalf("encode-slash: %s", got)
	}
	if got := uriEncode("AZaz09-_.~", true); got != "AZaz09-_.~" {
		t.Fatalf("unreserved must pass through: %s", got)
	}
}

func TestEncodeQuerySorted(t *testing.T) {
	v := url.Values{}
	v.Set("b", "2")
	v.Set("a", "1 1")
	v.Set("c", "x/y")
	got := encodeQuerySorted(v)
	want := "a=1%201&b=2&c=x%2Fy"
	if got != want {
		t.Fatalf("query encode:\n got=%s\nwant=%s", got, want)
	}
}

func TestPresignGetShape(t *testing.T) {
	c, err := New(Config{
		AccessKeyID:     "AKIDEXAMPLE",
		SecretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
		Bucket:          "memories",
		Endpoint:        "https://acct.r2.cloudflarestorage.com",
		Region:          "auto",
	})
	if err != nil {
		t.Fatal(err)
	}
	signed, err := c.PresignGet("02_04_2026/abc/master.m3u8", 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(signed)
	if err != nil {
		t.Fatalf("unparseable presigned url: %v", err)
	}
	if u.Path != "/memories/02_04_2026/abc/master.m3u8" {
		t.Fatalf("path: %s", u.Path)
	}
	q := u.Query()
	if q.Get("X-Amz-Algorithm") != algorithm {
		t.Fatalf("algorithm: %s", q.Get("X-Amz-Algorithm"))
	}
	sig := q.Get("X-Amz-Signature")
	if len(sig) != 64 {
		t.Fatalf("signature len=%d want 64", len(sig))
	}
	if _, err := hex.DecodeString(sig); err != nil {
		t.Fatalf("signature not hex: %v", err)
	}
	if !strings.HasPrefix(q.Get("X-Amz-Credential"), "AKIDEXAMPLE/") {
		t.Fatalf("credential: %s", q.Get("X-Amz-Credential"))
	}
}

func TestGetObject(t *testing.T) {
	objects := map[string]string{
		"/memories/01_02_2026/abc/captions/en.vtt": "WEBVTT",
		"/memories/01_02_2026/abc/big.jpg":         strings.Repeat("x", 100),
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !strings.HasPrefix(r.Header.Get("Authorization"), algorithm) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		body, ok := objects[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	c, err := New(Config{AccessKeyID: "a", SecretAccessKey: "b", Bucket: "memories", Endpoint: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	got, err := c.GetObject(ctx, "01_02_2026/abc/captions/en.vtt", 1<<10)
	if err != nil || string(got) != "WEBVTT" {
		t.Fatalf("got %q err %v", got, err)
	}
	if _, err := c.GetObject(ctx, "01_02_2026/abc/missing.vtt", 1<<10); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: err %v", err)
	}
	if _, err := c.GetObject(ctx, "01_02_2026/abc/big.jpg", 99); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("too large: err %v", err)
	}
	if _, err := c.GetObject(ctx, "01_02_2026/abc/big.jpg", 100); err != nil {
		t.Fatalf("exact size: err %v", err)
	}
}
