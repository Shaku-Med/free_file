package ffmpeg

import (
	"context"
	"os/exec"
)

// Every input here is a file on disk or a pipe, and most of them came from a
// user. ffmpeg's own default already keeps a local file off the network; this
// pins it for every input, pipes included, whatever the ffmpeg version, and
// drops the crypto and data wrappers nothing here needs.
const inputProtocols = "file,pipe"

// FFmpegCommand builds an ffmpeg exec.Cmd with OS-level hardening where supported.
// Arguments are argv slices  no shell is spawned, so shell metacharacters in paths
// are not interpreted by /bin/sh or cmd.exe.
func FFmpegCommand(ctx context.Context, args ...string) *exec.Cmd {
	name, argv := lowPriority("ffmpeg", restrictInputs(args))
	cmd := exec.CommandContext(ctx, name, argv...)
	applyExecHardening(cmd)
	return cmd
}

// FFprobeCommand is like FFmpegCommand but for ffprobe.
func FFprobeCommand(ctx context.Context, args ...string) *exec.Cmd {
	name, argv := lowPriority("ffprobe", append([]string{"-protocol_whitelist", inputProtocols}, args...))
	cmd := exec.CommandContext(ctx, name, argv...)
	applyExecHardening(cmd)
	return cmd
}

// restrictInputs puts the protocol whitelist in front of every -i, since
// ffmpeg input options only apply to the input that follows them.
func restrictInputs(args []string) []string {
	out := make([]string, 0, len(args)+4)
	for _, a := range args {
		if a == "-i" {
			out = append(out, "-protocol_whitelist", inputProtocols)
		}
		out = append(out, a)
	}
	return out
}
