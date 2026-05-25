package hls

import (
	"strings"
	"testing"
)

func TestRestrictMasterToLowestRendition(t *testing.T) {
	in := "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\n720p/playlist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n480p/playlist.m3u8\n"
	out := RestrictMasterToLowestRendition(in)
	if !strings.Contains(out, "480p/playlist.m3u8") {
		t.Fatalf("expected lowest variant, got %q", out)
	}
	if strings.Contains(out, "720p/playlist.m3u8") {
		t.Fatalf("higher variant should be removed")
	}
}

func TestTruncateMediaPlaylistAtDuration(t *testing.T) {
	in := "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg0.ts\n#EXTINF:6.0,\nseg1.ts\n#EXTINF:6.0,\nseg2.ts\n"
	out := TruncateMediaPlaylistAtDuration(in, 10)
	if strings.Contains(out, "seg2.ts") {
		t.Fatalf("segment beyond preview should be removed")
	}
	if !strings.Contains(out, "seg0.ts") {
		t.Fatalf("first segment should remain")
	}
	if !strings.Contains(out, "#EXT-X-ENDLIST") {
		t.Fatalf("truncated playlist should end")
	}
}
