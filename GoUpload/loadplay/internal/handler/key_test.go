package handler

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/binary"
	"strings"
	"testing"
	"time"

	"goupload/loadplay/internal/token"
)

var testSecret = []byte("0123456789abcdef0123456789abcdef")

func keyedToken() *token.Playback {
	return &token.Playback{FileID: "abc123", Path: "20_04_2026/abc123/master.m3u8", Nonce: "n0nce-value", Keyed: 1, Exp: time.Now().Add(time.Hour).UnixMilli()}
}

func TestEncryptSegmentIsHLSAES128(t *testing.T) {
	key := segmentKey(testSecret, keyedToken())
	for _, size := range []int{0, 1, 15, 16, 17, 188 * 7} {
		plain := bytes.Repeat([]byte{0x47}, size)
		sealed, err := encryptSegment(key, 42, plain)
		if err != nil {
			t.Fatal(err)
		}
		if len(sealed)%16 != 0 || len(sealed) <= size {
			t.Fatalf("size %d sealed to %d", size, len(sealed))
		}
		block, _ := aes.NewCipher(key)
		iv := make([]byte, 16)
		binary.BigEndian.PutUint64(iv[8:], 42)
		out := make([]byte, len(sealed))
		cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, sealed)
		pad := int(out[len(out)-1])
		if pad < 1 || pad > 16 || !bytes.Equal(out[:len(out)-pad], plain) {
			t.Fatalf("size %d did not round trip", size)
		}
	}
}

const mediaPlaylist = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:5\n#EXTINF:6.0,\nsegment_000.ts\n#EXTINF:4.0,\nsegment_001.ts\n#EXT-X-ENDLIST\n"

func TestRewriteAnnouncesTheKeyAndNumbersSegments(t *testing.T) {
	out, err := rewriteManifest(mediaPlaylist, "20_04_2026/abc123/360p/playlist.m3u8", "TOK", "abc123", "https://cdn.example", "https://cdn.example/v/abc123/lp.key?t=TOK")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(out, "#EXT-X-KEY") != 1 || !strings.Contains(out, `#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/v/abc123/lp.key?t=TOK"`+"\n#EXTINF:6.0,") {
		t.Fatalf("key line:\n%s", out)
	}
	for _, want := range []string{"360p/segment_000.ts?t=TOK&s=5\n", "360p/segment_001.ts?t=TOK&s=6\n"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in\n%s", want, out)
		}
	}

	plain, _ := rewriteManifest(mediaPlaylist, "20_04_2026/abc123/360p/playlist.m3u8", "TOK", "abc123", "https://cdn.example", "")
	if strings.Contains(plain, "EXT-X-KEY") || strings.Contains(plain, "&s=") {
		t.Fatalf("unkeyed playlist changed:\n%s", plain)
	}
}

func TestOnlyPlainTSPlaylistsAreKeyed(t *testing.T) {
	cases := map[string]bool{
		mediaPlaylist: true,
		"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n360p/playlist.m3u8\n":       false,
		"#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6,\nseg.m4s\n":        false,
		"#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n#EXTINF:6,\nseg.ts\n": false,
		"#EXTM3U\n#EXT-X-BYTERANGE:100@0\n#EXTINF:6,\nseg.ts\n":              false,
		"#EXTM3U\n#EXTINF:6,\nhttps://elsewhere.example/seg.ts\n":            false,
		"#EXTM3U\n#EXT-X-ENDLIST\n":                                          false,
	}
	for body, want := range cases {
		if got := keyablePlaylist(body); got != want {
			t.Errorf("keyablePlaylist(%q) = %v", body, got)
		}
	}
}

func proofFor(tok *token.Playback, r string) string {
	return base64.RawURLEncoding.EncodeToString(macOf(proofKey(testSecret, tok), "key|"+r))
}

func TestKeyNeedsTheProof(t *testing.T) {
	tok := keyedToken()
	r := "AAAAAAAAAAAAAAAAAAAAAA"

	masked, reason := maskedKey(testSecret, tok, r, proofFor(tok, r))
	if masked == nil {
		t.Fatalf("valid proof refused: %s", reason)
	}
	mask := macOf(proofKey(testSecret, tok), "mask|"+r)
	key := segmentKey(testSecret, tok)
	for i := range masked {
		if masked[i]^mask[i] != key[i] {
			t.Fatal("unmasked key is not the segment key")
		}
	}
	if bytes.Equal(masked, key) {
		t.Fatal("key sent in the clear")
	}

	// Each request's answer is masked differently, so one seen answer says
	// nothing about the key.
	other := "BBBBBBBBBBBBBBBBBBBBBB"
	if again, _ := maskedKey(testSecret, tok, other, proofFor(tok, other)); bytes.Equal(again, masked) {
		t.Fatal("two requests got the same masked key")
	}
	if _, reason := maskedKey(testSecret, tok, other, proofFor(tok, r)); reason != "mismatch" {
		t.Fatalf("proof for another r: %q", reason)
	}
	if _, reason := maskedKey(testSecret, tok, other, ""); reason != "mismatch" {
		t.Fatalf("no proof: %q", reason)
	}
	if _, reason := maskedKey(testSecret, tok, "short", proofFor(tok, "short")); reason != "malformed" {
		t.Fatalf("short r: %q", reason)
	}

	// A proof for one playback doesn't open another's key.
	stranger := keyedToken()
	stranger.Nonce = "someone-else"
	if _, reason := maskedKey(testSecret, stranger, other, proofFor(tok, other)); reason != "mismatch" {
		t.Fatalf("cross playback proof: %q", reason)
	}

	cast := keyedToken()
	cast.Cast = 1
	if _, reason := maskedKey(testSecret, cast, other, proofFor(cast, other)); reason != "not_keyed" {
		t.Fatalf("cast token: %q", reason)
	}
}

func TestSegmentSeqBounds(t *testing.T) {
	for raw, ok := range map[string]bool{"0": true, "42": true, "10000000": true, "10000001": false, "": false, "-1": false, "1e3": false, "123456789": false} {
		if _, got := segmentSeq(raw); got != ok {
			t.Errorf("segmentSeq(%q) ok = %v", raw, got)
		}
	}
}
