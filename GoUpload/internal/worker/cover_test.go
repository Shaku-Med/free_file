package worker

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func pngOf(t *testing.T, w, h int, c color.Color) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestNormalizeCoverShrinksToAPlainJPEG(t *testing.T) {
	out, err := normalizeCover(pngOf(t, 3000, 1500, color.NRGBA{0, 0, 0, 0}))
	if err != nil {
		t.Fatal(err)
	}
	img, format, err := image.Decode(bytes.NewReader(out))
	if err != nil || format != "jpeg" {
		t.Fatalf("format %q err %v, want jpeg", format, err)
	}
	if b := img.Bounds(); b.Dx() != coverMaxSide || b.Dy() != coverMaxSide/2 {
		t.Fatalf("got %dx%d, want %dx%d", b.Dx(), b.Dy(), coverMaxSide, coverMaxSide/2)
	}
	if r, g, b, _ := img.At(10, 10).RGBA(); r>>8 < 240 || g>>8 < 240 || b>>8 < 240 {
		t.Fatal("transparent areas should come out white, not black")
	}
}

func TestNormalizeCoverKeepsSmallSizes(t *testing.T) {
	out, err := normalizeCover(pngOf(t, 640, 360, color.White))
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(out))
	if err != nil || cfg.Width != 640 || cfg.Height != 360 {
		t.Fatalf("got %+v %v, want 640x360", cfg, err)
	}
}

func TestNormalizeCoverRefusesNonImages(t *testing.T) {
	for _, data := range [][]byte{
		[]byte("<html><script>alert(1)</script></html>"),
		[]byte("GIF89a<script>"),
		{},
	} {
		if _, err := normalizeCover(data); err == nil {
			t.Fatalf("accepted %q", data)
		}
	}
}

// A few hundred bytes can claim a canvas that would take gigabytes to decode.
func TestNormalizeCoverRefusesAHugeCanvasBeforeDecoding(t *testing.T) {
	small := pngOf(t, 1, 1, color.White)
	// Rewrite the IHDR size to 60000x60000 and fix its checksum.
	binary.BigEndian.PutUint32(small[16:], 60000)
	binary.BigEndian.PutUint32(small[20:], 60000)
	binary.BigEndian.PutUint32(small[29:], crc32.ChecksumIEEE(small[12:29]))
	if _, err := normalizeCover(small); err == nil {
		t.Fatal("a 60000 pixel canvas was accepted")
	}
}
