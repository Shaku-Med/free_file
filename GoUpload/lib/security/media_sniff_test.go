package security

import "testing"

func TestMediaKind(t *testing.T) {
	cases := []struct {
		name string
		head string
		want string
	}{
		{"jpeg", "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00", "image"},
		{"png", "\x89PNG\r\n\x1A\n\x00\x00\x00\rIHDR", "image"},
		{"gif", "GIF89a\x01\x00\x01\x00", "image"},
		{"webp", "RIFF\x24\x00\x00\x00WEBPVP8 ", "image"},
		{"bmp", "BM\x36\x00\x00\x00\x00\x00\x00\x00", "image"},
		{"mp4", "\x00\x00\x00\x20ftypisom\x00\x00\x02\x00", "video"},
		{"old quicktime", "\x00\x00\x00\x08wide\x00\x00\x00\x00", "video"},
		{"webm", "\x1A\x45\xDF\xA3\x9F\x42\x86\x81\x01", "video"},
		{"avi", "RIFF\x00\x10\x00\x00AVI LIST", "video"},
		{"wmv", "\x30\x26\xB2\x75\x8E\x66\xCF\x11\xA6\xD9\x00\xAA\x00\x62\xCE\x6C", "video"},
		{"flv", "FLV\x01\x05\x00\x00\x00\x09", "video"},

		// What ffmpeg would follow if it were let in.
		{"hls playlist", "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n", ""},
		{"concat script", "ffconcat version 1.0\nfile /etc/passwd\n", ""},
		{"dash manifest", "<?xml version=\"1.0\"?><MPD", ""},
		{"sdp", "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n", ""},
		{"svg", "<svg xmlns=\"http://www.w3.org/2000/svg\">", ""},
		{"html", "<!DOCTYPE html><html>", ""},
		{"php", "<?php system($_GET['c']);", ""},
		{"shell", "#!/bin/sh\nid\n", ""},
		{"elf", "\x7FELF\x02\x01\x01\x00", ""},
		{"zip", "PK\x03\x04\x14\x00", ""},
		{"riff but wav", "RIFF\x24\x00\x00\x00WAVEfmt ", ""},
		{"too short for a box", "\x00\x00\x00", ""},
		{"empty", "", ""},
	}
	for _, c := range cases {
		if got := MediaKind([]byte(c.head)); got != c.want {
			t.Errorf("%s: MediaKind = %q, want %q", c.name, got, c.want)
		}
	}
}
