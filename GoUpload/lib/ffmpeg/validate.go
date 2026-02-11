package ffmpeg

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
)

func ValidateVideo(path string) error {
	args := []string{
		"-v", "error",
		"-i", path,
		"-f", "null",
		"-t", "5",
		"-y",
		"-",
	}

	cmd := exec.Command("ffmpeg", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errOut := strings.TrimSpace(stderr.String())
		if errOut == "" {
			errOut = err.Error()
		}
		return fmt.Errorf("invalid video: %s", errOut)
	}

	return nil
}
