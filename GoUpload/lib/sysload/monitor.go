// Package sysload samples host CPU + memory pressure from /proc and from
// cgroup v2 (when the worker runs inside a Docker container with limits set).
// No external deps  just file reads. On non-Linux dev boxes the readers return
// 0% which means the worker pool will never throttle, exactly what we want for
// local testing.
package sysload

import (
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Snapshot struct {
	CPUPercent float64
	MemPercent float64
	Sampled    time.Time
}

type Monitor struct {
	interval time.Duration
	stopCh   chan struct{}
	wg       sync.WaitGroup
	current  atomic.Pointer[Snapshot]

	mu       sync.Mutex
	lastIdle uint64
	lastAll  uint64
	primed   bool
}

func New(interval time.Duration) *Monitor {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	m := &Monitor{
		interval: interval,
		stopCh:   make(chan struct{}),
	}
	zero := Snapshot{Sampled: time.Now()}
	m.current.Store(&zero)
	return m
}

func (m *Monitor) Start() {
	m.wg.Add(1)
	go m.loop()
}

func (m *Monitor) Stop() {
	close(m.stopCh)
	m.wg.Wait()
}

func (m *Monitor) Snapshot() Snapshot {
	if p := m.current.Load(); p != nil {
		return *p
	}
	return Snapshot{}
}

func (m *Monitor) loop() {
	defer m.wg.Done()
	t := time.NewTicker(m.interval)
	defer t.Stop()
	for {
		select {
		case <-m.stopCh:
			return
		case <-t.C:
			snap := Snapshot{
				CPUPercent: m.sampleCPU(),
				MemPercent: m.sampleMem(),
				Sampled:    time.Now(),
			}
			m.current.Store(&snap)
		}
	}
}

func (m *Monitor) sampleCPU() float64 {
	idle, all, ok := readProcStat()
	if !ok {
		return 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.primed {
		m.lastIdle = idle
		m.lastAll = all
		m.primed = true
		return 0
	}
	dIdle := idle - m.lastIdle
	dAll := all - m.lastAll
	m.lastIdle = idle
	m.lastAll = all
	if dAll == 0 {
		return 0
	}
	used := float64(dAll-dIdle) / float64(dAll) * 100.0
	if used < 0 {
		used = 0
	} else if used > 100 {
		used = 100
	}
	return used
}

func (m *Monitor) sampleMem() float64 {
	if p, ok := readCgroupV2Mem(); ok {
		return p
	}
	return readProcMeminfo()
}

// /proc/stat first line:
// cpu  user nice system idle iowait irq softirq steal guest guest_nice
func readProcStat() (idle uint64, all uint64, ok bool) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, false
	}
	line := strings.SplitN(string(data), "\n", 2)[0]
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0, false
	}
	values := make([]uint64, 0, len(fields)-1)
	for _, f := range fields[1:] {
		v, err := strconv.ParseUint(f, 10, 64)
		if err != nil {
			return 0, 0, false
		}
		values = append(values, v)
	}
	// idle = values[3] + iowait at values[4]
	if len(values) >= 5 {
		idle = values[3] + values[4]
	} else {
		idle = values[3]
	}
	for _, v := range values {
		all += v
	}
	return idle, all, true
}

func readProcMeminfo() float64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	var memTotal, memAvail uint64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			memTotal, _ = strconv.ParseUint(fields[1], 10, 64)
		case "MemAvailable:":
			memAvail, _ = strconv.ParseUint(fields[1], 10, 64)
		}
		if memTotal > 0 && memAvail > 0 {
			break
		}
	}
	if memTotal == 0 {
		return 0
	}
	used := float64(memTotal-memAvail) / float64(memTotal) * 100.0
	if used < 0 {
		used = 0
	} else if used > 100 {
		used = 100
	}
	return used
}

// readCgroupV2Mem returns container-scoped memory usage when running inside a
// Docker container with cgroups v2 + a memory limit set. Returns false when
// the limit is unset ("max") so we fall back to /proc/meminfo.
func readCgroupV2Mem() (float64, bool) {
	limitData, err := os.ReadFile("/sys/fs/cgroup/memory.max")
	if err != nil {
		return 0, false
	}
	limitStr := strings.TrimSpace(string(limitData))
	if limitStr == "" || limitStr == "max" {
		return 0, false
	}
	limit, err := strconv.ParseUint(limitStr, 10, 64)
	if err != nil || limit == 0 {
		return 0, false
	}
	usageData, err := os.ReadFile("/sys/fs/cgroup/memory.current")
	if err != nil {
		return 0, false
	}
	usage, err := strconv.ParseUint(strings.TrimSpace(string(usageData)), 10, 64)
	if err != nil {
		return 0, false
	}
	pct := float64(usage) / float64(limit) * 100.0
	if pct < 0 {
		pct = 0
	} else if pct > 100 {
		pct = 100
	}
	return pct, true
}
