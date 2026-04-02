//go:build linux

package ffmpeg

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// MemAvailableMB parses MemAvailable from /proc/meminfo (Linux).
func MemAvailableMB() (uint64, bool) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, false
	}
	defer f.Close()

	s := bufio.NewScanner(f)
	for s.Scan() {
		line := s.Text()
		if !strings.HasPrefix(line, "MemAvailable:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0, false
		}
		kb, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0, false
		}
		return kb / 1024, true
	}
	return 0, false
}
