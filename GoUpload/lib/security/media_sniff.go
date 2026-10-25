package security

import "bytes"

// MediaHeaderLen is how many leading bytes MediaKind needs to tell formats apart.
const MediaHeaderLen = 16

// isoBoxTypes are the box types an MP4, MOV or M4V can open with, after the
// 4 byte box size. Older QuickTime files skip ftyp and start with one of the rest.
var isoBoxTypes = [][]byte{
	[]byte("ftyp"), []byte("moov"), []byte("mdat"), []byte("free"),
	[]byte("skip"), []byte("wide"), []byte("pnot"),
}

// MediaKind says what a file really is from its first bytes: "image", "video",
// or "" for anything else.
//
// ffmpeg picks how to read a file from its content, never its name, so a text
// playlist or concat script saved as clip.mp4 makes it open whatever files or
// URLs the text lists, from inside the server. Only binary containers we
// accept are let through, which leaves ffmpeg nothing it would follow.
func MediaKind(head []byte) string {
	at := func(off int, sig string) bool {
		return len(head) >= off+len(sig) && bytes.Equal(head[off:off+len(sig)], []byte(sig))
	}
	switch {
	case at(0, "\xFF\xD8\xFF"),
		at(0, "\x89PNG\r\n\x1A\n"),
		at(0, "GIF87a"), at(0, "GIF89a"),
		at(0, "RIFF") && at(8, "WEBP"),
		at(0, "BM"):
		return "image"
	case at(0, "\x1A\x45\xDF\xA3"), // Matroska and WebM
		at(0, "RIFF") && at(8, "AVI "),
		at(0, "\x30\x26\xB2\x75\x8E\x66\xCF\x11\xA6\xD9\x00\xAA\x00\x62\xCE\x6C"), // ASF (WMV)
		at(0, "FLV\x01"):
		return "video"
	}
	if len(head) >= 8 {
		for _, box := range isoBoxTypes {
			if bytes.Equal(head[4:8], box) {
				return "video"
			}
		}
	}
	return ""
}
