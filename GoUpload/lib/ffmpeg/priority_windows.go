//go:build windows

package ffmpeg

func lowPriority(name string, args []string) (string, []string) {
	return name, args
}
