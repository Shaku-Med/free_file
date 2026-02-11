package colors

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"sort"

	_ "golang.org/x/image/webp"
)

type bucket struct {
	r, g, b int
	count   int
}

func (b bucket) hex() string {
	return fmt.Sprintf("#%02x%02x%02x", b.r/b.count, b.g/b.count, b.b/b.count)
}

func ExtractDominant(imageData []byte, count int) ([]string, error) {
	img, _, err := image.Decode(bytes.NewReader(imageData))
	if err != nil {
		return nil, err
	}

	bounds := img.Bounds()
	step := 1
	totalPixels := (bounds.Max.X - bounds.Min.X) * (bounds.Max.Y - bounds.Min.Y)
	if totalPixels > 50000 {
		step = totalPixels / 50000
		if step < 1 {
			step = 1
		}
	}

	buckets := make(map[uint32]*bucket)
	idx := 0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			idx++
			if idx%step != 0 {
				continue
			}
			r, g, b, a := img.At(x, y).RGBA()
			if a < 0x8000 {
				continue
			}
			r8 := int(r >> 8)
			g8 := int(g >> 8)
			b8 := int(b >> 8)

			qr := (r8 / 32) * 32
			qg := (g8 / 32) * 32
			qb := (b8 / 32) * 32
			key := uint32(qr)<<16 | uint32(qg)<<8 | uint32(qb)

			if b, ok := buckets[key]; ok {
				b.r += r8
				b.g += g8
				b.b += b8
				b.count++
			} else {
				buckets[key] = &bucket{r: r8, g: g8, b: b8, count: 1}
			}
		}
	}

	sorted := make([]*bucket, 0, len(buckets))
	for _, b := range buckets {
		sorted = append(sorted, b)
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].count > sorted[j].count
	})

	if count > len(sorted) {
		count = len(sorted)
	}

	result := make([]string, count)
	for i := 0; i < count; i++ {
		result[i] = sorted[i].hex()
	}
	return result, nil
}

func ExtractFromMultiple(images [][]byte, count int) []string {
	buckets := make(map[string]int)
	for _, imgData := range images {
		cols, err := ExtractDominant(imgData, count*2)
		if err != nil {
			continue
		}
		for i, c := range cols {
			weight := len(cols) - i
			buckets[c] += weight
		}
	}

	type pair struct {
		color  string
		weight int
	}
	pairs := make([]pair, 0, len(buckets))
	for c, w := range buckets {
		pairs = append(pairs, pair{color: c, weight: w})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].weight > pairs[j].weight
	})

	if count > len(pairs) {
		count = len(pairs)
	}
	result := make([]string, count)
	for i := 0; i < count; i++ {
		result[i] = pairs[i].color
	}
	return result
}
