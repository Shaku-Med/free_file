package handler

import "testing"

func TestPathUnderPlaybackRoot(t *testing.T) {
	tokenPath := "13_03_2026/abc/master.m3u8"
	cases := []struct {
		asked string
		want  bool
	}{
		{"13_03_2026/abc/master.m3u8", true},
		{"13_03_2026/abc/480p/playlist.m3u8", true},
		{"13_03_2026/abc/480p/seg000.ts", true},
		{"13_03_2026/other/master.m3u8", false},
		{"13_03_2026/abc/../other/480p/playlist.m3u8", false},
	}
	for _, tc := range cases {
		if got := pathUnderPlaybackRoot(tc.asked, tokenPath); got != tc.want {
			t.Errorf("pathUnderPlaybackRoot(%q) = %v, want %v", tc.asked, got, tc.want)
		}
	}
}

func TestManifestPathAllowed(t *testing.T) {
	allowed := "13_03_2026/abc/master.m3u8"
	if !manifestPathAllowed("13_03_2026/abc/480p/playlist.m3u8", allowed) {
		t.Fatal("expected variant playlist under asset root")
	}
	if manifestPathAllowed("13_03_2026/abc/480p/seg.ts", allowed) {
		t.Fatal("non-m3u8 should be rejected by manifestPathAllowed")
	}
}
