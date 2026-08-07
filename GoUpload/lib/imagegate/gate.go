// Package imagegate bounds how many image requests may run their CPU work at
// the same time.
//
// Profile pictures, comment images and custom thumbnails are handled inline in
// the HTTP request rather than through the upload queue, because the caller
// needs the resulting URL straight back. That is fine per request and bad in
// aggregate: each one decodes and resizes an image and calls the vision
// sidecar, and nothing stopped a burst of them from running all at once. On a
// two core box already busy with ffmpeg they compete directly with the video
// pipeline, which is how an unrelated comment thread can slow every upload on
// the server.
//
// Queued uploads deliberately do NOT pass through here. They already have the
// worker pool as their limit.
package imagegate

import (
	"context"
	"runtime"
	"time"

	"goupload/lib/env"
)

// waitTimeout caps how long a request will queue for a slot. Past this the
// caller is told to retry, which keeps HTTP goroutines from piling up behind a
// saturated box.
const waitTimeout = 15 * time.Second

var sem chan struct{}

func init() {
	n := int(env.GetInt64("IMAGE_CONCURRENCY", 0))
	if n <= 0 {
		// Half the cores, clamped to 2..4. The floor is 2 rather than 1 because
		// most of the wall time here is the vision sidecar call, which is
		// network wait rather than CPU; serialising on a 2 core box would make
		// two people commenting at once queue behind each other for no gain.
		n = runtime.NumCPU() / 2
		if n < 2 {
			n = 2
		}
		if n > 4 {
			n = 4
		}
	}
	sem = make(chan struct{}, n)
}

// Limit reports the configured ceiling. Useful for logs and health output.
func Limit() int { return cap(sem) }

// InFlight reports how many slots are currently held.
func InFlight() int { return len(sem) }

// Acquire blocks until a slot frees up, the caller's context ends, or
// waitTimeout elapses. Returns false when no slot was taken, in which case the
// caller must not call Release and should answer 503.
func Acquire(ctx context.Context) bool {
	timer := time.NewTimer(waitTimeout)
	defer timer.Stop()

	select {
	case sem <- struct{}{}:
		return true
	default:
	}

	select {
	case sem <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	case <-timer.C:
		return false
	}
}

// Release frees a slot. Only call it after Acquire returned true.
func Release() {
	select {
	case <-sem:
	default:
	}
}
