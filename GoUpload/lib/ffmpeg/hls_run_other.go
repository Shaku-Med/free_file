//go:build !linux

package ffmpeg

import "os/exec"

func runFFmpegWithOptionalMemGovernor(cmd *exec.Cmd) error {
	return cmd.Run()
}
