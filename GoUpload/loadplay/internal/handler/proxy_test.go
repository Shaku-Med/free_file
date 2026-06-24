package handler

import (
	"testing"

	"goupload/loadplay/lib/storage"
)

func TestParseByteRange(t *testing.T) {
	const size = 100
	cases := []struct {
		header          string
		wantStart, wEnd int
		ok              bool
	}{
		{"bytes=0-49", 0, 49, true},
		{"bytes=50-", 50, 99, true},
		{"bytes=-10", 90, 99, true},
		{"bytes=0-200", 0, 99, true}, // end clamped to size
		{"bytes=200-300", 0, 0, false}, // start past end
		{"bytes=10-5", 0, 0, false},     // end before start
		{"bytes=0-0,5-9", 0, 0, false},  // multi-range unsupported
		{"junk", 0, 0, false},
		{"", 0, 0, false},
	}
	for _, tc := range cases {
		start, end, ok := parseByteRange(tc.header, size)
		if ok != tc.ok || (ok && (start != tc.wantStart || end != tc.wEnd)) {
			t.Errorf("%q: got (%d,%d,%v) want (%d,%d,%v)",
				tc.header, start, end, ok, tc.wantStart, tc.wEnd, tc.ok)
		}
	}
}

func TestSegmentCacheKey(t *testing.T) {
	gh := storage.Config{Owner: "me", Repo: "vids", Branch: "main"}
	if got := segmentCacheKey(gh, "12_03_2026/abc/segments/0001.ts"); got != "github/me/vids/main/12_03_2026/abc/segments/0001.ts" {
		t.Errorf("github key = %q", got)
	}

	r2cfg := storage.Config{Backend: "r2", Bucket: "media"}
	if got := segmentCacheKey(r2cfg, "abc/0001.ts"); got != "r2/media/abc/0001.ts" {
		t.Errorf("r2 key = %q", got)
	}

	// An empty/root path yields an empty key, so it is never cached. (Real
	// traversal is already blocked upstream by the token + path-under-root
	// gate; PathFor clamps anything that slips through to a contained path.)
	if got := segmentCacheKey(gh, ""); got != "" {
		t.Errorf("empty path should give empty key, got %q", got)
	}

	// Missing owner/repo for github also yields empty (do not cache).
	if got := segmentCacheKey(storage.Config{}, "a/b.ts"); got != "" {
		t.Errorf("missing owner/repo should give empty key, got %q", got)
	}
}
