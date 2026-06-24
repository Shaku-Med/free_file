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

// GridCellMaxEdge bounds each cell's long edge in the full-quality grid. Much
// larger than the preview sprite so one file can back the cover picker, while
// still compressing small enough to commit to GitHub.
const GridCellMaxEdge = 640

const gridJPEGQuality = 85

type GridMeta struct {
	Duration   float64    `json:"duration"`
	Cols       int        `json:"cols"`
	Rows       int        `json:"rows"`
	CellWidth  int        `json:"cellWidth"`
	CellHeight int        `json:"cellHeight"`
	Width      int        `json:"width"`
	Height     int        `json:"height"`
	Interval   float64    `json:"interval"`
	Cells      []GridCell `json:"cells"`
}

type GridCell struct {
	Index      int     `json:"index"`
	X          int     `json:"x"`
	Y          int     `json:"y"`
	W          int     `json:"w"`
	H          int     `json:"h"`
	TimeOffset float64 `json:"timeOffset"`
	Start      float64 `json:"start"`
	End        float64 `json:"end"`
}

// BuildThumbnailGrid packs every extracted frame into ONE compressed image plus
// a JSON map (cell pixel rects + timestamps). This replaces the per-frame
// thumb_*.jpg files: one file uploads, one file serves, no thumb_001 sprawl.
func BuildThumbnailGrid(thumbDir string, result *ThumbnailResult) (gridPath, metaPath string, err error) {
	if result == nil || len(result.Thumbnails) == 0 {
		return "", "", fmt.Errorf("no thumbnails")
	}

	firstImg, _, err := image.Decode(bytes.NewReader(result.Thumbnails[0].Data))
	if err != nil {
		return "", "", fmt.Errorf("decode first thumbnail: %w", err)
	}
	b0 := firstImg.Bounds()
	cellW, cellH := previewCellDimensions(b0.Dx(), b0.Dy(), GridCellMaxEdge)
	if cellW <= 0 || cellH <= 0 {
		cellW, cellH = GridCellMaxEdge, GridCellMaxEdge
	}

	n := len(result.Thumbnails)
	cols := int(math.Ceil(math.Sqrt(float64(n))))
	if cols < 1 {
		cols = 1
	}
	rows := (n + cols - 1) / cols

	width, height := cols*cellW, rows*cellH
	img := image.NewRGBA(image.Rect(0, 0, width, height))

	cells := make([]GridCell, 0, n)
	for i, t := range result.Thumbnails {
		x, y := (i%cols)*cellW, (i/cols)*cellH
		dr := image.Rect(x, y, x+cellW, y+cellH)

		if src, _, derr := image.Decode(bytes.NewReader(t.Data)); derr == nil {
			if b := src.Bounds(); b.Dx() == cellW && b.Dy() == cellH {
				draw.Draw(img, dr, src, b.Min, draw.Src)
			} else {
				scaled := image.NewRGBA(image.Rect(0, 0, cellW, cellH))
				drawScaled(scaled, scaled.Bounds(), src, b)
				draw.Draw(img, dr, scaled, image.Pt(0, 0), draw.Src)
			}
		}

		start := float64(i) * result.Interval
		end := float64(i+1) * result.Interval
		if end > result.Duration {
			end = result.Duration
		}
		cells = append(cells, GridCell{
			Index: i, X: x, Y: y, W: cellW, H: cellH,
			TimeOffset: t.TimeOffset, Start: start, End: end,
		})
	}

	gridPath = filepath.Join(thumbDir, "thumbnail_grid.jpg")
	f, err := os.Create(gridPath)
	if err != nil {
		return "", "", err
	}
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: gridJPEGQuality}); err != nil {
		_ = f.Close()
		_ = os.Remove(gridPath)
		return "", "", err
	}
	_ = f.Close()

	meta := GridMeta{
		Duration: result.Duration, Cols: cols, Rows: rows,
		CellWidth: cellW, CellHeight: cellH, Width: width, Height: height,
		Interval: result.Interval, Cells: cells,
	}
	metaPath = filepath.Join(thumbDir, "thumbnail_grid.json")
	mf, err := os.Create(metaPath)
	if err != nil {
		return gridPath, "", err
	}
	_ = json.NewEncoder(mf).Encode(meta)
	_ = mf.Close()

	return gridPath, metaPath, nil
}
