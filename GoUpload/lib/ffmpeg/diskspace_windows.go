//go:build windows

package ffmpeg

func freeSpaceBytes(path string) (uint64, error) {
	return 1 << 60, nil
}

func RequireMinFreeSpace(path string, minBytes uint64) error {
	_, _ = path, minBytes
	return nil
}
