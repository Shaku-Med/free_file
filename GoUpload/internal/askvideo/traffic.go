package askvideo

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// What one Groq key may spend a minute on the free tier, as measured. Output
// is charged at the request's max_tokens when it starts.
const (
	keyInPerMin  = 7000
	keyOutPerMin = 1000
	// Groq also gives a free key 200,000 tokens a day, refilling as it goes,
	// and NSFWAPI's gore check and captions may run on the same keys. Ask
	// keeps to half, so it can't starve them. The count starts over when the
	// server does.
	keyAskPerDay = 100_000
	// Past this a viewer is told to come back soon instead of watching dots.
	maxQueueWait = 20 * time.Second
	maxQueued    = 300
	// A key that keeps failing rests, so an outage turns questions away fast
	// instead of piling them up on a dead upstream.
	keyFailLimit = 3
	keyRest      = 30 * time.Second
	// How long a key rests after a 429 that didn't say.
	keyRestUnknown = 10 * time.Second
	// What a typical question costs, for guessing the wait before it is built.
	typicalInTokens = 4500
	minBusyRetry    = 5 * time.Second
)

// busyError means the line for the model is long enough that the viewer is
// better off trying again after retry. cause is set when Groq itself said no.
type busyError struct {
	retry time.Duration
	cause error
}

func (e *busyError) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("askvideo: busy, retry in %s: %v", e.retry, e.cause)
	}
	return fmt.Sprintf("askvideo: busy, retry in %s", e.retry)
}

func busyFor(err error) (time.Duration, bool) {
	var b *busyError
	if errors.As(err, &b) {
		return b.retry, true
	}
	return 0, false
}

// bucket refills evenly over per, up to its size.
type bucket struct {
	size, level float64
	per         time.Duration
	at          time.Time
}

func newBucket(size float64, per time.Duration, now time.Time) bucket {
	return bucket{size: size, level: size, per: per, at: now}
}

func (b *bucket) rate() float64 { return b.size / b.per.Seconds() }

func (b *bucket) fill(now time.Time) {
	if now.After(b.at) {
		b.level = min(b.size, b.level+now.Sub(b.at).Seconds()*b.rate())
		b.at = now
	}
}

func (b *bucket) wait(n float64, now time.Time) time.Duration {
	b.fill(now)
	if b.level >= n {
		return 0
	}
	return time.Duration((n - b.level) / b.rate() * float64(time.Second))
}

func (b *bucket) give(n float64) { b.level = min(b.size, b.level+max(n, 0)) }

type keyState struct {
	key          string
	in, out, day bucket
	rest         time.Time
	fails        int
}

func (k *keyState) wait(in, out float64, now time.Time) time.Duration {
	return max(k.in.wait(in, now), k.out.wait(out, now), k.unavailable(in+out, now))
}

// unavailable is how long until the key could take n tokens of daily share,
// or comes back from resting.
func (k *keyState) unavailable(n float64, now time.Time) time.Duration {
	d := k.day.wait(n, now)
	if k.rest.After(now) {
		d = max(d, k.rest.Sub(now))
	}
	return d
}

type waiter struct {
	in, out float64
	grant   chan *keyState
}

// scheduler hands out keys so every request fits its key's per minute budget.
// Requests wait in one line, first come first served, and a viewer hears up
// front when the line is too long instead of hitting a 429 halfway through.
type scheduler struct {
	mu          sync.Mutex
	keys        []*keyState
	line        []*waiter
	timer       *time.Timer
	inPerMin    float64
	outPerMin   float64
	defaultRest time.Duration
}

func newScheduler(keys []string, inPerMin, outPerMin, perDay float64) *scheduler {
	now := time.Now()
	s := &scheduler{inPerMin: inPerMin, outPerMin: outPerMin, defaultRest: keyRestUnknown}
	for _, k := range keys {
		s.keys = append(s.keys, &keyState{
			key: k,
			in:  newBucket(inPerMin, time.Minute, now),
			out: newBucket(outPerMin, time.Minute, now),
			day: newBucket(perDay, 24*time.Hour, now),
		})
	}
	return s
}

// acquire waits in line for a key with room for the request. onWait hears the
// expected wait when the request has to queue.
func (s *scheduler) acquire(ctx context.Context, in, out float64, onWait func(time.Duration)) (*keyState, error) {
	in, out = min(in, s.inPerMin), min(out, s.outPerMin)
	s.mu.Lock()
	now := time.Now()
	if len(s.line) == 0 {
		if k := s.take(in, out, now); k != nil {
			s.mu.Unlock()
			return k, nil
		}
	}
	wait := s.estimate(in, out, now)
	if len(s.line) >= maxQueued || wait > maxQueueWait {
		s.mu.Unlock()
		return nil, &busyError{retry: max(wait, minBusyRetry)}
	}
	w := &waiter{in: in, out: out, grant: make(chan *keyState, 1)}
	s.line = append(s.line, w)
	s.arm(now)
	s.mu.Unlock()
	if onWait != nil {
		onWait(wait)
	}

	timeout := time.NewTimer(maxQueueWait)
	defer timeout.Stop()
	select {
	case k := <-w.grant:
		return k, nil
	case <-ctx.Done():
	case <-timeout.C:
	}
	s.mu.Lock()
	left := s.leave(w)
	s.mu.Unlock()
	if !left {
		// Granted just as the wait ran out.
		k := <-w.grant
		if ctx.Err() == nil {
			return k, nil
		}
		s.settle(k, in, out)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, &busyError{retry: s.crowded()}
}

// crowded is the expected wait for a new question right now; anything over
// maxQueueWait means turn it away.
func (s *scheduler) crowded() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.line) >= maxQueued {
		return 2 * maxQueueWait
	}
	return s.estimate(typicalInTokens, maxAnswerTokens, time.Now())
}

// settle gives back what a request didn't use: unspent output, or all of it
// when the request never ran.
func (s *scheduler) settle(k *keyState, in, out float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	k.in.fill(now)
	k.out.fill(now)
	k.day.fill(now)
	k.in.give(in)
	k.out.give(out)
	k.day.give(max(in, 0) + max(out, 0))
	s.arm(now)
}

// worked marks a key that answered, clearing its failures.
func (s *scheduler) worked(k *keyState) {
	s.mu.Lock()
	k.fails = 0
	s.mu.Unlock()
}

// limited rests a key Groq refused for rate, until it said the key frees up.
func (s *scheduler) limited(k *keyState, wait time.Duration) {
	if wait <= 0 {
		wait = s.defaultRest
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	k.rest = now.Add(wait)
	s.arm(now)
}

// observe lines a key up with what Groq says it has left this minute, which
// counts use this process can't see, like another server on the same key. It
// only ever lowers the local view. Groq reports input and output as one
// number, so the shortfall comes out of input first.
func (s *scheduler) observe(k *keyState, left float64) {
	if left < 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	k.in.fill(now)
	k.out.fill(now)
	if k.in.level+k.out.level <= left {
		return
	}
	k.out.level = min(k.out.level, left)
	k.in.level = min(k.in.level, left-k.out.level)
}

// failed counts an outage style failure; a key that keeps failing rests.
func (s *scheduler) failed(k *keyState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if k.fails++; k.fails >= keyFailLimit {
		k.fails = 0
		k.rest = time.Now().Add(keyRest)
	}
}

func (s *scheduler) take(in, out float64, now time.Time) *keyState {
	var best *keyState
	for _, k := range s.keys {
		if k.wait(in, out, now) == 0 && (best == nil || k.out.level > best.out.level) {
			best = k
		}
	}
	if best != nil {
		best.in.level -= in
		best.out.level -= out
		best.day.level -= in + out
	}
	return best
}

// estimate guesses when a request joining the line now would start: the line
// ahead is paid for first, out of every key's refill together.
func (s *scheduler) estimate(in, out float64, now time.Time) time.Duration {
	needIn, needOut := in, out
	for _, w := range s.line {
		needIn += w.in
		needOut += w.out
	}
	var haveIn, haveOut float64
	resting := time.Duration(-1)
	working := 0
	for _, k := range s.keys {
		// A key out of daily share is resting too, for longer.
		if d := k.unavailable(in+out, now); d > 0 {
			if resting < 0 || d < resting {
				resting = d
			}
			continue
		}
		k.in.fill(now)
		k.out.fill(now)
		haveIn += max(k.in.level, 0)
		haveOut += max(k.out.level, 0)
		working++
	}
	base := time.Duration(0)
	if working == 0 {
		if resting < 0 {
			return 2 * maxQueueWait
		}
		base, working, haveIn, haveOut = resting, len(s.keys), 0, 0
	}
	secs := max((needIn-haveIn)/(float64(working)*s.inPerMin/60), (needOut-haveOut)/(float64(working)*s.outPerMin/60), 0)
	return base + time.Duration(secs*float64(time.Second))
}

// arm schedules the next hand out for when the first in line could start.
func (s *scheduler) arm(now time.Time) {
	if len(s.line) == 0 {
		return
	}
	head := s.line[0]
	soonest := time.Duration(-1)
	for _, k := range s.keys {
		if d := k.wait(head.in, head.out, now); soonest < 0 || d < soonest {
			soonest = d
		}
	}
	soonest = max(soonest, 20*time.Millisecond)
	if s.timer == nil {
		s.timer = time.AfterFunc(soonest, s.dispatch)
	} else {
		s.timer.Reset(soonest)
	}
}

func (s *scheduler) dispatch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for len(s.line) > 0 {
		w := s.line[0]
		k := s.take(w.in, w.out, now)
		if k == nil {
			break
		}
		s.line = s.line[1:]
		w.grant <- k
	}
	s.arm(now)
}

func (s *scheduler) leave(w *waiter) bool {
	for i, x := range s.line {
		if x == w {
			s.line = append(s.line[:i], s.line[i+1:]...)
			s.arm(time.Now())
			return true
		}
	}
	return false
}

// requestTokens guesses a request's input tokens, on the high side.
func requestTokens(req chatRequest) int {
	n := 0
	for _, m := range req.Messages {
		n += 4
		switch c := m.Content.(type) {
		case string:
			n += estimateTokens(c)
		case []part:
			for _, p := range c {
				if p.ImageURL != nil {
					n += frameTokens
				} else {
					n += estimateTokens(p.Text)
				}
			}
		}
		for _, tc := range m.ToolCalls {
			n += estimateTokens(tc.Function.Name+tc.Function.Arguments) + 8
		}
	}
	if len(req.Tools) > 0 {
		n += 150
	}
	return n
}
