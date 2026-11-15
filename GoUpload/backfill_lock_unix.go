//go:build unix

package main

import (
	"errors"
	"os"
	"syscall"
)

// lockBackfill keeps a second run from starting while one is going. The kernel
// drops a flock when its process dies, so a run killed by a redeploy never
// leaves a stale lock behind.
func lockBackfill(p string) (func(), error) {
	f, err := os.OpenFile(p, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, errBackfillRunning
		}
		return nil, err
	}
	return func() { f.Close() }, nil
}
