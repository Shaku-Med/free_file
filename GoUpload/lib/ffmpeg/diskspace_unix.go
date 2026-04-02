//go:build !windows

package ffmpeg

import (
	"fmt"

	"golang.org/x/sys/unix"
)

func freeSpaceBytes(path string) (uint64, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, err
	}
	return uint64(st.Bavail) * uint64(st.Bsize), nil
}

// RequireMinFreeSpace ensures at least minBytes are free on the filesystem that owns path.
func RequireMinFreeSpace(path string, minBytes uint64) error {
	free, err := freeSpaceBytes(path)
	if err != nil {
		return fmt.Errorf("statfs %q: %w", path, err)
	}
	if free < minBytes {
		return fmt.Errorf("insufficient disk space on volume for %q: need %d bytes free, have %d", path, minBytes, free)
	}
	return nil
}
