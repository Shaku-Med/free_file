//go:build !windows

package ffmpeg

import (
	"os/exec"
	"syscall"
)

func applyExecHardening(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setsid = true
}
