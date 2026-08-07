package imagegate

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestNeverExceedsLimit(t *testing.T) {
	var live, peak int64
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if !Acquire(context.Background()) {
				return
			}
			defer Release()
			n := atomic.AddInt64(&live, 1)
			for {
				p := atomic.LoadInt64(&peak)
				if n <= p || atomic.CompareAndSwapInt64(&peak, p, n) {
					break
				}
			}
			time.Sleep(5 * time.Millisecond)
			atomic.AddInt64(&live, -1)
		}()
	}
	wg.Wait()

	if peak > int64(Limit()) {
		t.Fatalf("peak concurrency %d exceeded limit %d", peak, Limit())
	}
	if InFlight() != 0 {
		t.Fatalf("slots leaked: %d still held", InFlight())
	}
	t.Logf("limit=%d peak=%d, no leak", Limit(), peak)
}

func TestCancelledContextDoesNotLeakASlot(t *testing.T) {
	// Fill every slot.
	for i := 0; i < Limit(); i++ {
		if !Acquire(context.Background()) {
			t.Fatal("could not fill")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if Acquire(ctx) {
		t.Fatal("acquired on a cancelled context while saturated")
	}
	if InFlight() != Limit() {
		t.Fatalf("expected %d held, got %d", Limit(), InFlight())
	}
	for i := 0; i < Limit(); i++ {
		Release()
	}
	if InFlight() != 0 {
		t.Fatalf("slots leaked after release: %d", InFlight())
	}
}
