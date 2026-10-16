//go:build !windows

package ffmpeg

import (
	"log"
	"os"
	"os/exec"
	"strconv"
	"sync"
)

var (
	niceOnce  sync.Once
	nicePath  string
	niceLevel string
)

// lowPriority runs encodes under nice so playback, uploads and the API keep
// the CPU when an encode and a viewer want it at the same time. FFMPEG_NICE
// sets the level (default 10, 0 turns it off). nice execs the real binary, so
// the pid, signals and the memory governor all still reach ffmpeg itself.
func lowPriority(name string, args []string) (string, []string) {
	niceOnce.Do(func() {
		level := 10
		if raw := os.Getenv("FFMPEG_NICE"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 0 || n > 19 {
				log.Fatalf("FFMPEG_NICE must be a whole number from 0 to 19, got %q", raw)
			}
			level = n
		}
		if level == 0 {
			return
		}
		p, err := exec.LookPath("nice")
		if err != nil {
			log.Printf("goupload ffmpeg: nice not found, encodes run at normal priority")
			return
		}
		nicePath, niceLevel = p, strconv.Itoa(level)
	})
	if nicePath == "" {
		return name, args
	}
	return nicePath, append([]string{"-n", niceLevel, name}, args...)
}
