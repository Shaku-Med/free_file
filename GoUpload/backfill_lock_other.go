//go:build !unix

package main

import (
	"errors"
	"os"
)

// Only the Linux container runs the backfill for real; without flock a local
// run settles for a lock file that is removed on the way out.
func lockBackfill(p string) (func(), error) {
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if errors.Is(err, os.ErrExist) {
		return nil, errBackfillRunning
	}
	if err != nil {
		return nil, err
	}
	f.Close()
	return func() { os.Remove(p) }, nil
}
