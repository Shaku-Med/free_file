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
	Duration   float64       `json:"duration"`
	Cols       int           `json:"cols"`
	Rows       int           `json:"rows"`
	CellWidth  int           `json:"cellWidth"`
	CellHeight int           `json:"cellHeight"`
	CellSize   int           `json:"cellSize"`
	Interval   float64       `json:"interval"`
	Cells      []PreviewCell `json:"cells"`
}

type PreviewCell struct {
	Index int     `json:"index"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

func previewCellDimensions(sw, sh, maxEdge int) (dw, dh int) {
	if sw <= 0 || sh <= 0 {
		return maxEdge, maxEdge
	}
	if sw >= sh {
		dw = maxEdge
		dh = int(float64(sh) * float64(maxEdge) / float64(sw))
	} else {
		dh = maxEdge
		dw = int(float64(sw) * float64(maxEdge) / float64(sh))
	}
	if dw < 1 {
		dw = 1
	}
	if dh < 1 {
		dh = 1
	}
	return dw, dh
}

func BuildThumbnailPreview(thumbDir string, result *ThumbnailResult) (previewPath, metaPath string, err error) {
	if result == nil || len(result.Thumbnails) == 0 {
		return "", "", fmt.Errorf("no thumbnails")
	}

	firstImg, _, err := image.Decode(bytes.NewReader(result.Thumbnails[0].Data))
	if err != nil {
		return "", "", fmt.Errorf("decode first thumbnail: %w", err)
	}
	b0 := firstImg.Bounds()
	cellW, cellH := previewCellDimensions(b0.Dx(), b0.Dy(), PreviewGridCellSize)
	if cellW <= 0 || cellH <= 0 {
		cellW = PreviewGridCellSize
		cellH = PreviewGridCellSize
	}

	N := len(result.Thumbnails)
	cols := int(math.Ceil(math.Sqrt(float64(N))))
	if cols < 1 {
		cols = 1
	}
	rows := (N + cols - 1) / cols

	width := cols * cellW
	height := rows * cellH

	img := image.NewRGBA(image.Rect(0, 0, width, height))

	for i, t := range result.Thumbnails {
		src, _, err := image.Decode(bytes.NewReader(t.Data))
		if err != nil {
			continue
		}

		col := i % cols
		row := i / cols
		dr := image.Rect(col*cellW, row*cellH, (col+1)*cellW, (row+1)*cellH)

		b := src.Bounds()
		if b.Dx() == cellW && b.Dy() == cellH {
			draw.Draw(img, dr, src, b.Min, draw.Src)
		} else {
			scaled := image.NewRGBA(image.Rect(0, 0, cellW, cellH))
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

	// Grid/sprite only: smaller cells above + lower JPEG quality keeps preview light.
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 72}); err != nil {
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
		Duration:   result.Duration,
		Cols:       cols,
		Rows:       rows,
		CellWidth:  cellW,
		CellHeight: cellH,
		CellSize:   cellW,
		Interval:   result.Interval,
		Cells:      cells,
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
