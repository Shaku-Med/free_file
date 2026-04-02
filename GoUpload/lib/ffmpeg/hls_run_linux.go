//go:build linux

package ffmpeg

import (
	"log"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"
)

func envUint64(key string, def uint64) uint64 {
	s := os.Getenv(key)
	if s == "" {
		return def
	}
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return def
	}
	return n
}

// runFFmpegWithOptionalMemGovernor starts cmd and, when GOUpload_HLS_MEM_GOVERNOR=1,
// periodically pauses the child with SIGSTOP if MemAvailable drops below
// GOUpload_HLS_MEM_PAUSE_MB (default 400) and resumes with SIGCONT above
// GOUpload_HLS_MEM_RESUME_MB (default 700). Pausing does not free the encoder’s
// RSS; it only yields the CPU and can help the kernel reclaim page cache or let
// other jobs finish.
func runFFmpegWithOptionalMemGovernor(cmd *exec.Cmd) error {
	if os.Getenv("GOUpload_HLS_MEM_GOVERNOR") != "1" {
		return cmd.Run()
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(3 * time.Second)
		defer t.Stop()
		pauseMB := envUint64("GOUpload_HLS_MEM_PAUSE_MB", 400)
		resumeMB := envUint64("GOUpload_HLS_MEM_RESUME_MB", 700)
		if resumeMB <= pauseMB {
			resumeMB = pauseMB + 256
		}
		paused := false
		for {
			select {
			case <-done:
				if paused && cmd.Process != nil {
					_ = cmd.Process.Signal(syscall.SIGCONT)
				}
				return
			case <-t.C:
				if cmd.Process == nil {
					continue
				}
				avail, ok := MemAvailableMB()
				if !ok {
					continue
				}
				if !paused && avail < pauseMB {
					if err := cmd.Process.Signal(syscall.SIGSTOP); err == nil {
						paused = true
						log.Printf("goupload ffmpeg: paused (MemAvailable=%d MB < %d MB)", avail, pauseMB)
					}
				} else if paused && avail > resumeMB {
					if err := cmd.Process.Signal(syscall.SIGCONT); err == nil {
						paused = false
						log.Printf("goupload ffmpeg: resumed (MemAvailable=%d MB > %d MB)", avail, resumeMB)
					}
				}
			}
		}
	}()

	err := cmd.Wait()
	close(done)
	wg.Wait()
	return err
}
