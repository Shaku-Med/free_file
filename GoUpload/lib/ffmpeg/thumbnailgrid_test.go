package ffmpeg

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"testing"
)

func makeJPEG(t *testing.T, w, h int, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode: %v", err)
	}
	return buf.Bytes()
}

func TestBuildThumbnailGrid(t *testing.T) {
	dir := t.TempDir()
	frame := makeJPEG(t, 320, 180, color.RGBA{R: 10, G: 120, B: 200, A: 255})
	res := &ThumbnailResult{
		Duration: 30,
		Interval: 10,
		Thumbnails: []Thumbnail{
			{TimeOffset: 0, Data: frame},
			{TimeOffset: 10, Data: frame},
			{TimeOffset: 20, Data: frame},
		},
	}

	gridPath, metaPath, err := BuildThumbnailGrid(dir, res)
	if err != nil {
		t.Fatalf("BuildThumbnailGrid: %v", err)
	}

	gridBytes, err := os.ReadFile(gridPath)
	if err != nil {
		t.Fatalf("read grid: %v", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(gridBytes))
	if err != nil {
		t.Fatalf("decode grid config: %v", err)
	}

	metaBytes, err := os.ReadFile(metaPath)
	if err != nil {
		t.Fatalf("read meta: %v", err)
	}
	var meta GridMeta
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		t.Fatalf("unmarshal meta: %v", err)
	}

	if len(meta.Cells) != 3 {
		t.Fatalf("want 3 cells, got %d", len(meta.Cells))
	}
	// 3 frames -> ceil(sqrt(3)) = 2 cols, 2 rows.
	if meta.Cols != 2 || meta.Rows != 2 {
		t.Fatalf("grid layout cols=%d rows=%d, want 2x2", meta.Cols, meta.Rows)
	}
	// 16:9 cell capped to 640 long edge -> 640x360.
	if meta.CellWidth != 640 || meta.CellHeight != 360 {
		t.Fatalf("cell dims %dx%d, want 640x360", meta.CellWidth, meta.CellHeight)
	}
	if cfg.Width != meta.Width || cfg.Height != meta.Height {
		t.Fatalf("image %dx%d != meta %dx%d", cfg.Width, cfg.Height, meta.Width, meta.Height)
	}
	// Second cell sits at column 1, row 0.
	if c := meta.Cells[1]; c.X != 640 || c.Y != 0 {
		t.Fatalf("cell[1] at (%d,%d), want (640,0)", c.X, c.Y)
	}
	// Third cell wraps to row 1.
	if c := meta.Cells[2]; c.X != 0 || c.Y != 360 {
		t.Fatalf("cell[2] at (%d,%d), want (0,360)", c.X, c.Y)
	}
}

func TestBuildThumbnailGridEmpty(t *testing.T) {
	if _, _, err := BuildThumbnailGrid(t.TempDir(), &ThumbnailResult{}); err == nil {
		t.Fatal("expected error on empty result")
	}
}
