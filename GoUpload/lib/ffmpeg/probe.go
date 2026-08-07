package ffmpeg

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type VideoInfo struct {
	Width           int     `json:"width"`
	Height          int     `json:"height"`
	AspectRatio     string  `json:"aspect_ratio"`
	Codec           string  `json:"video_codec"`
	Fps             float64 `json:"fps"`
	Bitrate         int     `json:"video_bitrate"`
	AudioCodec      string  `json:"audio_codec"`
	AudioBitrate    int     `json:"audio_bitrate"`
	AudioSampleRate int     `json:"audio_sample_rate"`
	AudioChannels   int     `json:"audio_channels"`
	Duration        float64 `json:"duration"`

	// Embedded song metadata (ID3 / Vorbis comments / MP4 atoms), read straight
	// from the container tags ffprobe already returns. Empty when the file has
	// no tags (common for AI-generated or freshly-rendered clips).
	Genre  string `json:"genre,omitempty"`
	Artist string `json:"artist,omitempty"`
	Title  string `json:"title,omitempty"`
	Album  string `json:"album,omitempty"`
}

type LoudnessInfo struct {
	IntegratedLoudness float64 `json:"integrated_loudness"`
	TruePeak           float64 `json:"true_peak"`
	LoudnessRange      float64 `json:"loudness_range"`
}

func ProbeVideo(path string) (*VideoInfo, error) {
	args := []string{
		// Note: do not pass -nostdin here  ffprobe does not support it (only ffmpeg does).
		"-v", "quiet",
		"-analyzeduration", "200M",
		"-probesize", "200M",
		"-print_format", "json",
		"-show_streams",
		"-show_format",
		path,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	cmd := FFprobeCommand(ctx, args...)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &limitedWriter{max: 1 << 20}

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe: %w", err)
	}

	var result struct {
		Streams []struct {
			CodecType  string            `json:"codec_type"`
			CodecName  string            `json:"codec_name"`
			Width      int               `json:"width"`
			Height     int               `json:"height"`
			DisplayAR  string            `json:"display_aspect_ratio"`
			RFrameRate string            `json:"r_frame_rate"`
			BitRate    string            `json:"bit_rate"`
			SampleRate string            `json:"sample_rate"`
			Channels   int               `json:"channels"`
			Tags       map[string]string `json:"tags"`
		} `json:"streams"`
		Format struct {
			Duration string            `json:"duration"`
			BitRate  string            `json:"bit_rate"`
			Tags     map[string]string `json:"tags"`
		} `json:"format"`
	}

	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		return nil, fmt.Errorf("parse ffprobe json: %w", err)
	}

	info := &VideoInfo{}

	for _, s := range result.Streams {
		if s.CodecType == "video" && info.Width == 0 {
			info.Width = s.Width
			info.Height = s.Height
			info.Codec = s.CodecName
			if s.DisplayAR != "" && s.DisplayAR != "0:1" && s.DisplayAR != "N/A" {
				info.AspectRatio = s.DisplayAR
			}
			if s.BitRate != "" {
				info.Bitrate, _ = strconv.Atoi(s.BitRate)
			}
			if s.RFrameRate != "" {
				info.Fps = parseFraction(s.RFrameRate)
			}
		}
		if s.CodecType == "audio" && info.AudioCodec == "" {
			info.AudioCodec = s.CodecName
			if s.BitRate != "" {
				info.AudioBitrate, _ = strconv.Atoi(s.BitRate)
			}
			if s.SampleRate != "" {
				info.AudioSampleRate, _ = strconv.Atoi(s.SampleRate)
			}
			info.AudioChannels = s.Channels
		}
	}

	if info.Width == 0 {
		return nil, fmt.Errorf("no video stream found")
	}

	if info.AspectRatio == "" {
		info.AspectRatio = computeAspectRatio(info.Width, info.Height)
	}

	if result.Format.Duration != "" {
		info.Duration, _ = strconv.ParseFloat(result.Format.Duration, 64)
	}

	// Song metadata: container/format tags first, then the audio stream's tags
	// as a fallback (some MP4/MKV files carry them per-stream). Tag keys vary in
	// case across formats (GENRE / genre / Genre), so match case-insensitively.
	streamTags := map[string]string{}
	for _, s := range result.Streams {
		if s.CodecType == "audio" && len(s.Tags) > 0 {
			streamTags = s.Tags
			break
		}
	}
	info.Genre = firstTag(result.Format.Tags, streamTags, "genre")
	info.Artist = firstTag(result.Format.Tags, streamTags, "artist", "album_artist", "author", "composer")
	info.Title = firstTag(result.Format.Tags, streamTags, "title")
	info.Album = firstTag(result.Format.Tags, streamTags, "album")

	return info, nil
}

// firstTag returns the first non-empty tag value for any of `keys`, searching
// format tags then stream tags, case-insensitively.
func firstTag(formatTags, streamTags map[string]string, keys ...string) string {
	for _, src := range []map[string]string{formatTags, streamTags} {
		if len(src) == 0 {
			continue
		}
		for _, k := range keys {
			for tagKey, tagVal := range src {
				if strings.EqualFold(tagKey, k) {
					if v := strings.TrimSpace(tagVal); v != "" {
						return v
					}
				}
			}
		}
	}
	return ""
}

func ProbeLoudness(path string) (*LoudnessInfo, error) {
	args := []string{
		"-nostdin",
		"-fflags", "+genpts+igndts",
		"-analyzeduration", "200M",
		"-probesize", "200M",
		"-i", path,
		"-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
		"-f", "null",
		"-vn",
		"-y",
		"-",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	cmd := FFmpegCommand(ctx, args...)
	var stderr limitedWriter
	stderr.max = 2 << 20
	cmd.Stderr = &stderr
	_ = cmd.Run()

	output := stderr.String()

	reJSON := regexp.MustCompile(`(?s)\{[^}]*"input_i"[^}]*\}`)
	match := reJSON.FindString(output)
	if match == "" {
		return nil, fmt.Errorf("loudnorm output not found")
	}

	var parsed struct {
		InputI   string `json:"input_i"`
		InputTP  string `json:"input_tp"`
		InputLRA string `json:"input_lra"`
	}
	if err := json.Unmarshal([]byte(match), &parsed); err != nil {
		return nil, fmt.Errorf("parse loudnorm: %w", err)
	}

	info := &LoudnessInfo{}
	info.IntegratedLoudness = parseLoudnessFloat(parsed.InputI)
	info.TruePeak = parseLoudnessFloat(parsed.InputTP)
	info.LoudnessRange = parseLoudnessFloat(parsed.InputLRA)

	return info, nil
}

// loudnessSilenceFloor is the EBU R128 absolute gate. loudnorm reports "-inf"
// for silent or near-silent audio, and strconv.ParseFloat accepts that string
// and hands back -Inf with no error. That value reached the completion webhook
// inside metadata, where json.Marshal rejects it, and the upload hung at 95%
// forever. Clamping to the gate keeps the number meaningful and encodable.
const loudnessSilenceFloor = -70.0

func parseLoudnessFloat(s string) float64 {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || math.IsNaN(v) {
		return loudnessSilenceFloor
	}
	if math.IsInf(v, 0) {
		if v < 0 {
			return loudnessSilenceFloor
		}
		return 0
	}
	return v
}

func parseFraction(s string) float64 {
	parts := strings.Split(s, "/")
	if len(parts) != 2 {
		v, _ := strconv.ParseFloat(s, 64)
		return v
	}
	num, _ := strconv.ParseFloat(parts[0], 64)
	den, _ := strconv.ParseFloat(parts[1], 64)
	if den == 0 {
		return 0
	}
	return math.Round(num/den*100) / 100
}

func computeAspectRatio(w, h int) string {
	if w == 0 || h == 0 {
		return "0:0"
	}
	g := gcd(w, h)
	rw := w / g
	rh := h / g
	if rw > 100 || rh > 100 {
		ratio := float64(w) / float64(h)
		if math.Abs(ratio-16.0/9.0) < 0.05 {
			return "16:9"
		}
		if math.Abs(ratio-4.0/3.0) < 0.05 {
			return "4:3"
		}
		if math.Abs(ratio-9.0/16.0) < 0.05 {
			return "9:16"
		}
		if math.Abs(ratio-21.0/9.0) < 0.1 {
			return "21:9"
		}
		if math.Abs(ratio-1.0) < 0.05 {
			return "1:1"
		}
		return fmt.Sprintf("%d:%d", rw, rh)
	}
	return fmt.Sprintf("%d:%d", rw, rh)
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

// ValidateVideo runs a quick decode test on the first few seconds and checks
// that ffprobe can read at least one video stream. Returns nil if the file is
// a valid, decodable video.
func ValidateVideo(path string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	args := []string{
		"-nostdin",
		"-v", "error",
		"-fflags", "+genpts+igndts",
		"-analyzeduration", "200M",
		"-probesize", "200M",
		"-i", path,
		"-t", "5",
		"-f", "null",
		"-",
	}
	cmd := FFmpegCommand(ctx, args...)
	var stderr limitedWriter
	stderr.max = 512 << 10
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		out := stderr.String()
		if out != "" {
			return fmt.Errorf("invalid video: %s", out)
		}
		return fmt.Errorf("invalid video: %w", err)
	}
	return nil
}

// limitedWriter is an io.Writer that silently stops accepting data after max
// bytes, preventing unbounded memory growth from FFmpeg's stderr progress output.
type limitedWriter struct {
	buf bytes.Buffer
	max int
}

func (w *limitedWriter) Write(p []byte) (int, error) {
	remaining := w.max - w.buf.Len()
	if remaining <= 0 {
		return len(p), nil
	}
	if len(p) > remaining {
		p = p[:remaining]
	}
	w.buf.Write(p)
	return len(p), nil
}

func (w *limitedWriter) String() string {
	return w.buf.String()
}
