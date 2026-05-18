package worker

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"goupload/internal/upload"
	"goupload/lib/logger"
	"goupload/lib/sysload"
)

// PoolConfig holds tunables for the adaptive worker pool. All fields are
// optional; sensible defaults kick in when unset so the caller only has to
// override what they want.
type PoolConfig struct {
	// MinWorkers floor concurrency. Always at least 1 worker is processing,
	// even under heavy system load — otherwise the queue would just stall.
	MinWorkers int
	// MaxWorkers ceiling concurrency. Hard cap on how many jobs can run at once.
	MaxWorkers int
	// Initial number of active workers at startup.
	InitialWorkers int
	// CPUHigh / CPULow are the upper / lower thresholds (percent) that trigger
	// throttle down / up decisions.
	CPUHigh float64
	CPULow  float64
	// MemHigh memory pressure threshold that forces a throttle-down even when
	// CPU is fine. No "MemLow" — we only ramp on CPU.
	MemHigh float64
	// Cooldown gap between adjustments so we don't oscillate.
	Cooldown time.Duration
	// SampleInterval how often the sysload monitor refreshes its snapshot.
	SampleInterval time.Duration
	// OrphanCleanupInterval frequency of the orphaned-chunk sweeper.
	OrphanCleanupInterval time.Duration
	// OrphanMaxAge chunks older than this are considered orphaned.
	OrphanMaxAge time.Duration
}

func (c *PoolConfig) defaults() {
	if c.MinWorkers < 1 {
		c.MinWorkers = 1
	}
	if c.MaxWorkers < c.MinWorkers {
		c.MaxWorkers = 6
	}
	if c.InitialWorkers < c.MinWorkers {
		c.InitialWorkers = c.MinWorkers
	}
	if c.InitialWorkers > c.MaxWorkers {
		c.InitialWorkers = c.MaxWorkers
	}
	if c.CPUHigh <= 0 {
		c.CPUHigh = 85
	}
	if c.CPULow <= 0 {
		c.CPULow = 60
	}
	if c.MemHigh <= 0 {
		c.MemHigh = 88
	}
	if c.Cooldown <= 0 {
		c.Cooldown = 5 * time.Second
	}
	if c.SampleInterval <= 0 {
		c.SampleInterval = 2 * time.Second
	}
	if c.OrphanCleanupInterval <= 0 {
		c.OrphanCleanupInterval = 30 * time.Minute
	}
	if c.OrphanMaxAge <= 0 {
		c.OrphanMaxAge = 24 * time.Hour
	}
}

// Pool owns N worker goroutines + a controller goroutine that watches CPU /
// memory pressure and adjusts the number of *active* workers. Running jobs
// always finish; throttling only affects whether a worker dequeues the *next*
// job once its current one is done.
type Pool struct {
	worker       *Worker
	cfg          PoolConfig
	monitor      *sysload.Monitor
	log          *logger.Logger
	activeTarget atomic.Int32
	stopCh       chan struct{}
	wg           sync.WaitGroup
}

func NewPool(w *Worker, cfg PoolConfig) *Pool {
	cfg.defaults()
	p := &Pool{
		worker:  w,
		cfg:     cfg,
		monitor: sysload.New(cfg.SampleInterval),
		log:     w.log,
		stopCh:  make(chan struct{}),
	}
	p.activeTarget.Store(int32(cfg.InitialWorkers))
	return p
}

func (p *Pool) Start() {
	p.monitor.Start()
	for i := 0; i < p.cfg.MaxWorkers; i++ {
		p.wg.Add(1)
		go p.runWorker(i)
	}
	p.wg.Add(1)
	go p.runController()
	p.wg.Add(1)
	go p.runOrphanCleanup()
	p.log.Infof("pool started max=%d min=%d initial=%d", p.cfg.MaxWorkers, p.cfg.MinWorkers, p.cfg.InitialWorkers)
}

func (p *Pool) Stop() {
	close(p.stopCh)
	p.wg.Wait()
	p.monitor.Stop()
	p.log.Infof("pool stopped")
}

func (p *Pool) active() int32 {
	return p.activeTarget.Load()
}

// runWorker — worker idx i runs when active >= i+1. Otherwise it idles in
// 500 ms ticks rechecking. The currently-running job (if any) finishes first.
func (p *Pool) runWorker(idx int) {
	defer p.wg.Done()
	idleTicker := time.NewTicker(500 * time.Millisecond)
	defer idleTicker.Stop()
	for {
		select {
		case <-p.stopCh:
			return
		default:
		}
		if int(p.active()) <= idx {
			select {
			case <-p.stopCh:
				return
			case <-idleTicker.C:
			}
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		job, err := p.worker.queue.Dequeue(ctx, 3*time.Second)
		cancel()
		if err != nil {
			p.log.Errorf("worker#%d dequeue error: %s", idx, err.Error())
			time.Sleep(time.Second)
			continue
		}
		if job == nil {
			continue
		}
		p.worker.processJob(job)
	}
}

// runController watches CPU + memory pressure and steers activeTarget within
// [MinWorkers, MaxWorkers]. Adjustments are throttled by Cooldown so a brief
// spike doesn't ping-pong the pool size.
func (p *Pool) runController() {
	defer p.wg.Done()
	t := time.NewTicker(p.cfg.SampleInterval)
	defer t.Stop()
	lastAdjust := time.Time{}
	for {
		select {
		case <-p.stopCh:
			return
		case <-t.C:
		}
		if time.Since(lastAdjust) < p.cfg.Cooldown {
			continue
		}
		snap := p.monitor.Snapshot()
		current := int(p.active())
		next := current
		if snap.MemPercent >= p.cfg.MemHigh && current > p.cfg.MinWorkers {
			next = current - 1
		} else if snap.CPUPercent >= p.cfg.CPUHigh && current > p.cfg.MinWorkers {
			next = current - 1
		} else if snap.CPUPercent <= p.cfg.CPULow &&
			snap.MemPercent < p.cfg.MemHigh-10 &&
			current < p.cfg.MaxWorkers {
			next = current + 1
		}
		if next != current {
			p.activeTarget.Store(int32(next))
			lastAdjust = time.Now()
			p.log.Infof("pool resize %d -> %d (cpu=%.1f%% mem=%.1f%%)", current, next, snap.CPUPercent, snap.MemPercent)
		}
	}
}

// runOrphanCleanup periodically removes stale chunk dirs from interrupted
// uploads. Previously this lived inline in the single-worker run loop.
func (p *Pool) runOrphanCleanup() {
	defer p.wg.Done()
	t := time.NewTicker(p.cfg.OrphanCleanupInterval)
	defer t.Stop()
	sweep := func() {
		n, err := upload.CleanupOrphanedChunks(p.worker.cfg.ChunksDir, p.cfg.OrphanMaxAge)
		if err == nil && n > 0 {
			p.log.Infof("orphan chunk cleanup removed %d dirs", n)
		}
	}
	sweep()
	for {
		select {
		case <-p.stopCh:
			return
		case <-t.C:
			sweep()
		}
	}
}
