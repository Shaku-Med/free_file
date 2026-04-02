//go:build !linux

package ffmpeg

// MemAvailableMB is only used on Linux; elsewhere returns “plenty” so governor never pauses.
func MemAvailableMB() (uint64, bool) {
	return 1 << 30, true
}
