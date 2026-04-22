//go:build windows

package ffmpeg

import "os/exec"

func applyExecHardening(cmd *exec.Cmd) {
	_ = cmd
}
