package ffmpeg

import (
	"context"
	"os/exec"
)

// FFmpegCommand builds an ffmpeg exec.Cmd with OS-level hardening where supported.
// Arguments are argv slices  no shell is spawned, so shell metacharacters in paths
// are not interpreted by /bin/sh or cmd.exe.
func FFmpegCommand(ctx context.Context, args ...string) *exec.Cmd {
	name, argv := lowPriority("ffmpeg", args)
	cmd := exec.CommandContext(ctx, name, argv...)
	applyExecHardening(cmd)
	return cmd
}

// FFprobeCommand is like FFmpegCommand but for ffprobe.
func FFprobeCommand(ctx context.Context, args ...string) *exec.Cmd {
	name, argv := lowPriority("ffprobe", args)
	cmd := exec.CommandContext(ctx, name, argv...)
	applyExecHardening(cmd)
	return cmd
}
