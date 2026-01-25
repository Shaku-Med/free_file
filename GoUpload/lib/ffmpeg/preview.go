package ffmpeg

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"math"
	"os"
	"path/filepath"
)

type PreviewMeta struct {
	Duration float64     `json:"duration"`
	Cols     int         `json:"cols"`
	Rows     int         `json:"rows"`
	CellSize int         `json:"cellSize"`
	Interval float64     `json:"interval"`
	Cells    []PreviewCell `json:"cells"`
}

type PreviewCell struct {
	Index int     `json:"index"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

func BuildThumbnailPreview(thumbDir string, result *ThumbnailResult) (previewPath, metaPath string, err error) {
	if result == nil || len(result.Thumbnails) == 0 {
		return "", "", fmt.Errorf("no thumbnails")
	}

	N := len(result.Thumbnails)
	cell := ThumbCellSize
	cols := int(math.Ceil(math.Sqrt(float64(N))))
	if cols < 1 {
		cols = 1
	}
	rows := (N + cols - 1) / cols

	width := cols * cell
	height := rows * cell

	img := image.NewRGBA(image.Rect(0, 0, width, height))

	for i, t := range result.Thumbnails {
		src, _, err := image.Decode(bytes.NewReader(t.Data))
		if err != nil {
			continue
		}

		col := i % cols
		row := i / cols
		dr := image.Rect(col*cell, row*cell, (col+1)*cell, (row+1)*cell)

		b := src.Bounds()
		if b.Dx() == cell && b.Dy() == cell {
			draw.Draw(img, dr, src, b.Min, draw.Src)
		} else {
			scaled := image.NewRGBA(image.Rect(0, 0, cell, cell))
			drawScaled(scaled, scaled.Bounds(), src, b)
			draw.Draw(img, dr, scaled, image.Pt(0, 0), draw.Src)
		}
	}

	previewPath = filepath.Join(thumbDir, "thumbnail_preview.jpg")
	f, err := os.Create(previewPath)
	if err != nil {
		return "", "", err
	}
	defer f.Close()

	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 85}); err != nil {
		_ = os.Remove(previewPath)
		return "", "", err
	}

	cells := make([]PreviewCell, N)
	for i := 0; i < N; i++ {
		start := float64(i) * result.Interval
		end := float64(i+1) * result.Interval
		if end > result.Duration {
			end = result.Duration
		}
		cells[i] = PreviewCell{Index: i, Start: start, End: end}
	}

	meta := PreviewMeta{
		Duration: result.Duration,
		Cols:     cols,
		Rows:     rows,
		CellSize: cell,
		Interval: result.Interval,
		Cells:    cells,
	}

	metaPath = filepath.Join(thumbDir, "thumbnail_preview.json")
	mf, err := os.Create(metaPath)
	if err != nil {
		return previewPath, "", err
	}
	enc := json.NewEncoder(mf)
	enc.SetIndent("", "")
	_ = enc.Encode(meta)
	_ = mf.Close()

	return previewPath, metaPath, nil
}

func drawScaled(dst *image.RGBA, dr image.Rectangle, src image.Image, sr image.Rectangle) {
	sw, sh := sr.Dx(), sr.Dy()
	dw, dh := dr.Dx(), dr.Dy()
	for y := 0; y < dh; y++ {
		for x := 0; x < dw; x++ {
			sx := sr.Min.X + (x*sw)/dw
			sy := sr.Min.Y + (y*sh)/dh
			dst.Set(dr.Min.X+x, dr.Min.Y+y, src.At(sx, sy))
		}
	}
}
