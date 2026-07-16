//go:build linux

package ffmpeg

import (
	"log"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// Governor registry: tracks every governed ffmpeg so the pause policy can
// guarantee forward progress. The OLDEST running encode never pauses — memory
// pressure drains as that job finishes, instead of every job freezing at once
// (SIGSTOP keeps RSS resident, so pausing everything deadlocks the box).
var (
	govMu    sync.Mutex
	govStart = map[*exec.Cmd]time.Time{}
)

func govRegister(cmd *exec.Cmd) {
	govMu.Lock()
	govStart[cmd] = time.Now()
	govMu.Unlock()
}

func govUnregister(cmd *exec.Cmd) {
	govMu.Lock()
	delete(govStart, cmd)
	govMu.Unlock()
}

// govIsOldest reports whether cmd is the longest-running governed encode.
func govIsOldest(cmd *exec.Cmd) bool {
	govMu.Lock()
	defer govMu.Unlock()
	mine, ok := govStart[cmd]
	if !ok {
		return true
	}
	for other, ts := range govStart {
		if other != cmd && ts.Before(mine) {
			return false
		}
	}
	return true
}

// runFFmpegWithOptionalMemGovernor starts cmd and periodically pauses the
// child with SIGSTOP if MemAvailable drops below GOUpload_HLS_MEM_PAUSE_MB
// (default 400), resuming with SIGCONT above GOUpload_HLS_MEM_RESUME_MB
// (default 700). ON by default; set GOUpload_HLS_MEM_GOVERNOR=0 to disable.
//
// Two rules keep it deadlock-free:
//   - the oldest running encode is never paused, so memory always drains;
//   - a paused encode that becomes the oldest is resumed even while memory
//     is still tight (someone must make progress).
func runFFmpegWithOptionalMemGovernor(cmd *exec.Cmd) error {
	if os.Getenv("GOUpload_HLS_MEM_GOVERNOR") == "0" {
		return cmd.Run()
	}

	if err := cmd.Start(); err != nil {
		return err
	}
	govRegister(cmd)
	defer govUnregister(cmd)

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
				if !paused && avail < pauseMB && !govIsOldest(cmd) {
					if err := cmd.Process.Signal(syscall.SIGSTOP); err == nil {
						paused = true
						log.Printf("goupload ffmpeg: paused (MemAvailable=%d MB < %d MB)", avail, pauseMB)
					}
				} else if paused && (avail > resumeMB || govIsOldest(cmd)) {
					if err := cmd.Process.Signal(syscall.SIGCONT); err == nil {
						paused = false
						log.Printf("goupload ffmpeg: resumed (MemAvailable=%d MB)", avail)
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
