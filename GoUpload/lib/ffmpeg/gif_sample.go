package ffmpeg

import (
	"bytes"
	"context"
	"fmt"
	"image/gif"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// SampleGIFForVision returns PNG-encoded raster frames spread across an animated GIF (for vision / NSFW APIs).
// Static GIFs return one PNG. On ffmpeg failure, falls back to the first decoded frame.
func SampleGIFForVision(ctx context.Context, gifData []byte, maxSamples int) ([][]byte, error) {
	if maxSamples < 1 {
		maxSamples = 3
	}

	g, err := gif.DecodeAll(bytes.NewReader(gifData))
	if err != nil {
		return nil, fmt.Errorf("gif decode: %w", err)
	}
	if len(g.Image) == 0 {
		return nil, fmt.Errorf("empty gif")
	}
	if len(g.Image) == 1 {
		return encodeGIFFirstFramePNG(g)
	}

	tmpDir, err := os.MkdirTemp("", "gif-vision-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	inPath := filepath.Join(tmpDir, "in.gif")
	if err := os.WriteFile(inPath, gifData, 0600); err != nil {
		return nil, err
	}

	n := len(g.Image)
	samples := maxSamples
	if n < samples {
		samples = n
	}

	seen := make(map[int]struct{})
	var indices []int
	for i := 0; i < samples; i++ {
		idx := 0
		if samples > 1 {
			idx = i * (n - 1) / (samples - 1)
		}
		if _, ok := seen[idx]; ok {
			continue
		}
		seen[idx] = struct{}{}
		indices = append(indices, idx)
	}

	parts := make([]string, len(indices))
	for i, idx := range indices {
		parts[i] = fmt.Sprintf("eq(n,%d)", idx)
	}
	sel := strings.Join(parts, "+")
	vf := fmt.Sprintf("select=%s,setpts=N/TB,scale='min(960,iw)':-2", sel)

	outPat := filepath.Join(tmpDir, "f-%03d.png")
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", inPath,
		"-vf", vf,
		"-vsync", "0",
		outPat,
	}

	c, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(c, "ffmpeg", args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return encodeGIFFirstFramePNG(g)
	}

	matches, _ := filepath.Glob(filepath.Join(tmpDir, "f-*.png"))
	sort.Strings(matches)
	var out [][]byte
	for _, m := range matches {
		b, rerr := os.ReadFile(m)
		if rerr != nil || len(b) == 0 {
			continue
		}
		out = append(out, b)
	}
	if len(out) == 0 {
		return encodeGIFFirstFramePNG(g)
	}
	return out, nil
}

func encodeGIFFirstFramePNG(g *gif.GIF) ([][]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, g.Image[0]); err != nil {
		return nil, err
	}
	return [][]byte{buf.Bytes()}, nil
}
