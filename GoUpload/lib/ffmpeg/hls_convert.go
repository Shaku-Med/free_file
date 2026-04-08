package ffmpeg

import (
	"fmt"
	"runtime"
)

func buildTierArgs(inputPath, m3u8Path, segmentPattern string, opts HLSOptions, tier QualityTier, useGPU bool, hasAudio bool) []string {
	cpuThreads := 2
	if n := runtime.NumCPU(); n == 1 {
		cpuThreads = 1
	}

	var args []string

	if useGPU {
		args = append(args, "-hwaccel", "cuda")
	}

	seg := opts.SegmentTime
	if seg <= 0 {
		seg = 10
	}

	args = append(args,
		"-nostdin",
		"-fflags", "+genpts+igndts+discardcorrupt",
		"-err_detect", "ignore_err",
		"-avoid_negative_ts", "make_zero",
		"-analyzeduration", "50M",
		"-probesize", "50M",
		"-i", inputPath,
		"-map", "0:v:0?",
	)
	if hasAudio {
		args = append(args, "-map", "0:a:0?")
	}

	scale := fmt.Sprintf("scale='min(%d,iw)':-2", tier.Width)

	args = append(args,
		"-fps_mode", "vfr",
		"-vf", scale,
		"-force_key_frames", fmt.Sprintf("expr:gte(t,n_forced*%d)", seg),
	)

	if useGPU {
		args = append(args,
			"-c:v", "h264_nvenc",
			"-preset", "p4",
			"-rc", "vbr",
			"-cq", tier.CRF,
			"-b:v", tier.MaxRate,
			"-maxrate", tier.MaxRate,
			"-bufsize", tier.BufSize,
		)
	} else {
		args = append(args,
			"-threads", fmt.Sprintf("%d", cpuThreads),
			"-c:v", "libx264",
			"-preset", "veryfast",
			"-tune", "fastdecode",
			"-x264-params", fmt.Sprintf("threads=%d:rc-lookahead=20", cpuThreads),
			"-crf", tier.CRF,
			"-maxrate", tier.MaxRate,
			"-bufsize", tier.BufSize,
		)
	}

	if hasAudio {
		args = append(args,
			"-c:a", "aac",
			"-b:a", tier.AudioBR,
			"-ac", "2",
			"-ar", "48000",
		)
	} else {
		args = append(args, "-an")
	}

	args = append(args,
		"-max_muxing_queue_size", "1024",
		"-hls_time", fmt.Sprintf("%d", seg),
		"-hls_list_size", "0",
		"-hls_segment_filename", segmentPattern,
		"-hls_playlist_type", "vod",
		"-hls_flags", "independent_segments",
		"-hls_allow_cache", "0",
		"-hls_start_number_source", "0",
		"-f", "hls",
		"-y",
		m3u8Path,
	)

	return args
}
