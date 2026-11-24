package askvideo

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"math"
	"regexp"
	"strings"

	"golang.org/x/image/draw"
)

const (
	maxTranscriptChars = 12000
	maxFrames          = 400
	// Groq bills an image the same at any size, so the frames go in at a size
	// where each still is big enough to make out.
	gridMaxEdge     = 960
	gridMaxPixels   = 50_000_000
	maxMosaicFrames = 16
	// Captions arrive a few words at a time. One timestamp per stretch of
	// speech keeps the moments findable while costing far fewer tokens.
	transcriptGroupSecs  = 10
	transcriptGroupChars = 180
)

type frames struct {
	JPEGBase64 string
	Times      []float64
}

// gridCell is where one still sits in thumbnail_grid.jpg and when it was taken.
type gridCell struct {
	X, Y, W, H int
	Time       float64
}

// shrinkGrid turns the frame grid into the image the model sees. When the
// cells are known it lays out up to maxMosaicFrames stills spread evenly over
// the video, since a long video's grid shrunk whole leaves each still a few
// pixels wide. The grid is ours, but its pixels come from someone's upload, so
// the size is checked before decoding.
func shrinkGrid(data []byte, cells []gridCell) (*frames, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if format != "jpeg" || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > gridMaxPixels {
		return nil, errors.New("askvideo: unusable grid")
	}
	src, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}

	var dst *image.RGBA
	var times []float64
	if picked := sampleCells(cells, src.Bounds()); len(picked) > 0 {
		dst, times = mosaic(src, picked)
	} else {
		w, h := fit(cfg.Width, cfg.Height, gridMaxEdge)
		dst = image.NewRGBA(image.Rect(0, 0, w, h))
		draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
		for _, c := range cells {
			times = append(times, c.Time)
		}
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 80}); err != nil {
		return nil, err
	}
	return &frames{JPEGBase64: base64.StdEncoding.EncodeToString(out.Bytes()), Times: times}, nil
}

// sampleCells picks stills evenly across the video, or nothing when any cell
// falls outside the grid, in which case the whole grid is shrunk instead.
func sampleCells(cells []gridCell, bounds image.Rectangle) []gridCell {
	if len(cells) == 0 {
		return nil
	}
	for _, c := range cells {
		r := image.Rect(c.X, c.Y, c.X+c.W, c.Y+c.H)
		if c.W <= 0 || c.H <= 0 || !r.In(bounds) {
			return nil
		}
	}
	n := min(len(cells), maxMosaicFrames)
	out := make([]gridCell, n)
	for i := range out {
		out[i] = cells[i*len(cells)/n]
	}
	return out
}

func mosaic(src image.Image, cells []gridCell) (*image.RGBA, []float64) {
	cols := int(math.Ceil(math.Sqrt(float64(len(cells)))))
	rows := (len(cells) + cols - 1) / cols
	cw, ch := fit(cells[0].W, cells[0].H, gridMaxEdge/cols)
	if rows*ch > gridMaxEdge {
		cw, ch = fit(cw, ch, gridMaxEdge/rows)
	}
	dst := image.NewRGBA(image.Rect(0, 0, cols*cw, rows*ch))
	times := make([]float64, len(cells))
	for i, c := range cells {
		x, y := (i%cols)*cw, (i/cols)*ch
		draw.ApproxBiLinear.Scale(dst, image.Rect(x, y, x+cw, y+ch), src, image.Rect(c.X, c.Y, c.X+c.W, c.Y+c.H), draw.Src, nil)
		times[i] = c.Time
	}
	return dst, times
}

// fit scales w by h down so the longer side is at most edge.
func fit(w, h, edge int) (int, int) {
	if w > edge || h > edge {
		if w >= h {
			w, h = edge, h*edge/w
		} else {
			w, h = w*edge/h, edge
		}
	}
	return max(w, 1), max(h, 1)
}

var byteOrderMark = string(rune(0xFEFF))

var (
	cueTimingPattern = regexp.MustCompile(`^(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s+-->`)
	cueTagPattern    = regexp.MustCompile(`<[^>]*>`)
)

// vttToTranscript turns captions into "[m:ss] text" lines so the model can
// point at moments, dropping repeats that rolling captions produce and joining
// short cues into one line per stretch of speech.
func vttToTranscript(data []byte, maxChars int) string {
	var b strings.Builder
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 0, 64<<10), 64<<10)
	var cur strings.Builder
	curStart, start := 0.0, 0.0
	timed, inNote, full := false, false, false
	last := ""
	flush := func() bool {
		if cur.Len() == 0 {
			return true
		}
		entry := "[" + clock(curStart) + "] " + cur.String() + "\n"
		cur.Reset()
		if b.Len()+len(entry) > maxChars {
			b.WriteString("[transcript cut short]\n")
			return false
		}
		b.WriteString(entry)
		return true
	}
	for !full && sc.Scan() {
		line := strings.TrimSpace(strings.TrimPrefix(sc.Text(), byteOrderMark))
		switch {
		case line == "":
			inNote, timed = false, false
			continue
		case inNote:
			continue
		case strings.HasPrefix(line, "WEBVTT"):
			continue
		case line == "NOTE" || strings.HasPrefix(line, "NOTE ") || line == "STYLE" || line == "REGION":
			inNote = true
			continue
		case cueTimingPattern.MatchString(line):
			start, timed = parseCueStart(line), true
			continue
		}
		if !timed {
			continue // a cue identifier line before its timing
		}
		text := cleanData(strings.Join(strings.Fields(cueTagPattern.ReplaceAllString(line, "")), " "))
		if text == "" || text == last {
			continue
		}
		last = text
		if cur.Len() > 0 && (start < curStart || start-curStart >= transcriptGroupSecs || cur.Len()+len(text) > transcriptGroupChars) {
			full = !flush()
		}
		if full {
			break
		}
		if cur.Len() == 0 {
			curStart = start
		} else {
			cur.WriteByte(' ')
		}
		cur.WriteString(text)
	}
	if !full {
		flush()
	}
	return strings.TrimSpace(b.String())
}

func parseCueStart(line string) float64 {
	start := strings.Fields(line)[0]
	start = strings.ReplaceAll(start, ",", ".")
	parts := strings.Split(start, ":")
	var secs float64
	for _, p := range parts {
		var f float64
		if _, err := fmt.Sscanf(p, "%g", &f); err != nil {
			return 0
		}
		secs = secs*60 + f
	}
	return secs
}

func clock(secs float64) string {
	if secs < 0 {
		secs = 0
	}
	t := int(secs)
	h, m, s := t/3600, (t%3600)/60, t%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}
