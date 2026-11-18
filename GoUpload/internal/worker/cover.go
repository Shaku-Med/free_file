package worker

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// coverMaxSide keeps an uploaded cover small enough to check and to serve.
const coverMaxSide = 1920

const coverMaxInputSide = 8192

// normalizeCover turns an uploader's cover into a plain JPEG at most
// coverMaxSide on its longest side. Re-encoding drops anything riding along in
// the original, like location metadata or bytes that are not an image at all.
func normalizeCover(data []byte) ([]byte, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	// Checked from the header before decoding: a small file can claim a canvas
	// big enough to exhaust memory.
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > coverMaxInputSide || cfg.Height > coverMaxInputSide {
		return nil, errors.New("cover dimensions out of range")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if longest := max(w, h); longest > coverMaxSide {
		w = max(1, w*coverMaxSide/longest)
		h = max(1, h*coverMaxSide/longest)
	}
	// White under transparent areas, which JPEG would otherwise turn black.
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), image.White, image.Point{}, draw.Src)
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 88}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// checkedCover returns the uploader's cover ready to publish, or an error when
// it must not be used: not an image, explicit, or impossible to check right
// now. The caller falls back to a frame from the video, which goes through
// the same checks as the rest of it.
func (w *Worker) checkedCover(data []byte) ([]byte, error) {
	cover, err := normalizeCover(data)
	if err != nil {
		return nil, fmt.Errorf("not a usable image: %w", err)
	}
	res, err := w.nsfw.DetectGate(cover)
	if err != nil {
		return nil, fmt.Errorf("could not be checked: %w", err)
	}
	if res.IsNSFW {
		return nil, errors.New("flagged by the vision check")
	}
	return cover, nil
}
