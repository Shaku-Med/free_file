package ffmpeg

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
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
}

type LoudnessInfo struct {
	IntegratedLoudness float64 `json:"integrated_loudness"`
	TruePeak           float64 `json:"true_peak"`
	LoudnessRange      float64 `json:"loudness_range"`
}

func ProbeVideo(path string) (*VideoInfo, error) {
	args := []string{
		"-v", "quiet",
		"-print_format", "json",
		"-show_streams",
		"-show_format",
		path,
	}

	cmd := exec.Command("ffprobe", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe: %w, stderr: %s", err, stderr.String())
	}

	var result struct {
		Streams []struct {
			CodecType      string `json:"codec_type"`
			CodecName      string `json:"codec_name"`
			Width          int    `json:"width"`
			Height         int    `json:"height"`
			DisplayAR      string `json:"display_aspect_ratio"`
			RFrameRate     string `json:"r_frame_rate"`
			BitRate        string `json:"bit_rate"`
			SampleRate     string `json:"sample_rate"`
			Channels       int    `json:"channels"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
			BitRate  string `json:"bit_rate"`
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

	return info, nil
}

func ProbeLoudness(path string) (*LoudnessInfo, error) {
	args := []string{
		"-i", path,
		"-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
		"-f", "null",
		"-vn",
		"-y",
		"-",
	}

	cmd := exec.Command("ffmpeg", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	_ = cmd.Run()

	output := stderr.String()

	reJSON := regexp.MustCompile(`(?s)\{[^}]*"input_i"[^}]*\}`)
	match := reJSON.FindString(output)
	if match == "" {
		return nil, fmt.Errorf("loudnorm output not found")
	}

	var parsed struct {
		InputI  string `json:"input_i"`
		InputTP string `json:"input_tp"`
		InputLRA string `json:"input_lra"`
	}
	if err := json.Unmarshal([]byte(match), &parsed); err != nil {
		return nil, fmt.Errorf("parse loudnorm: %w", err)
	}

	info := &LoudnessInfo{}
	info.IntegratedLoudness, _ = strconv.ParseFloat(parsed.InputI, 64)
	info.TruePeak, _ = strconv.ParseFloat(parsed.InputTP, 64)
	info.LoudnessRange, _ = strconv.ParseFloat(parsed.InputLRA, 64)

	return info, nil
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
