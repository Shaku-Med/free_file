package fetchgate

import (
	"context"
	"errors"
	"time"
)

// Gate caps the number of concurrent upstream fetches. When the cap
// is hit, additional callers queue on the semaphore up to `wait`. If
// the wait expires, we shed load with ErrBusy rather than letting
// the queue grow unbounded — that's how a slow GitHub turns into a
// memory blow-up otherwise.
//
// Sizing: maxConcurrent should be ~ (peak QPS × p99 fetch seconds).
// For 100 manifest fetches/sec with 1s p99, 100 is a good floor.
type Gate struct {
	sem  chan struct{}
	wait time.Duration
}

var ErrBusy = errors.New("upstream fetch gate busy")

func New(maxConcurrent int, queueWait time.Duration) *Gate {
	if maxConcurrent <= 0 {
		maxConcurrent = 64
	}
	if queueWait <= 0 {
		queueWait = 2 * time.Second
	}
	return &Gate{sem: make(chan struct{}, maxConcurrent), wait: queueWait}
}

// Acquire blocks up to the configured wait; release with the returned
// func when done. ctx cancellation is honored (request aborted client-side).
func (g *Gate) Acquire(ctx context.Context) (func(), error) {
	t := time.NewTimer(g.wait)
	defer t.Stop()
	select {
	case g.sem <- struct{}{}:
		return func() { <-g.sem }, nil
	case <-t.C:
		return nil, ErrBusy
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
