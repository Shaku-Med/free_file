package askvideo

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// drained returns a scheduler whose keys have no output left, refilling at
// outPerMin, so the next requests have to queue.
func drained(keys int, outPerMin float64) *scheduler {
	names := make([]string, keys)
	for i := range names {
		names[i] = fmt.Sprintf("k%d", i+1)
	}
	s := newScheduler(names, 1e9, outPerMin, 1e9)
	for _, k := range s.keys {
		k.out.level = 0
	}
	return s
}

func TestSchedulerServesInOrder(t *testing.T) {
	s := drained(1, 60_000) // 1000 a second, so 100 is ready every 0.1s
	var mu sync.Mutex
	var order []int
	var waits []time.Duration
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := s.acquire(context.Background(), 10, 100, func(d time.Duration) {
				mu.Lock()
				waits = append(waits, d)
				mu.Unlock()
			})
			if err != nil {
				t.Errorf("%d: %v", i, err)
				return
			}
			mu.Lock()
			order = append(order, i)
			mu.Unlock()
		}(i)
		time.Sleep(10 * time.Millisecond) // join the line in this order
	}
	wg.Wait()
	if fmt.Sprint(order) != "[0 1 2 3]" {
		t.Fatalf("served out of order: %v", order)
	}
	if len(waits) != 4 || waits[3] <= waits[0] {
		t.Fatalf("waits should grow down the line: %v", waits)
	}
}

func TestSchedulerTurnsAwayALongLine(t *testing.T) {
	s := drained(2, 600) // 10 a second across each key
	start := time.Now()
	_, err := s.acquire(context.Background(), 10, 600, nil)
	wait, busy := busyFor(err)
	if !busy || wait < maxQueueWait || time.Since(start) > 100*time.Millisecond {
		t.Fatalf("err %v wait %s after %s", err, wait, time.Since(start))
	}
	if got := s.crowded(); got <= maxQueueWait {
		t.Fatalf("crowded %s", got)
	}
}

func TestSchedulerLeavesTheLine(t *testing.T) {
	s := drained(1, 600)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := s.acquire(ctx, 10, 100, nil); err != context.DeadlineExceeded {
		t.Fatalf("err %v", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.line) != 0 {
		t.Fatalf("%d still in line", len(s.line))
	}
}

func TestSchedulerRestsKeys(t *testing.T) {
	s := newScheduler([]string{"k1", "k2"}, 1e9, 1e9, 1e9)
	k1 := s.keys[0]
	for i := 0; i < keyFailLimit; i++ {
		s.failed(k1)
	}
	for i := 0; i < 5; i++ {
		k, err := s.acquire(context.Background(), 1, 1, nil)
		if err != nil || k.key != "k2" {
			t.Fatalf("a failing key was used: %v %v", k, err)
		}
	}
	// Both resting: the request waits for the one that frees up first.
	s.limited(s.keys[1], 60*time.Millisecond)
	start := time.Now()
	k, err := s.acquire(context.Background(), 1, 1, nil)
	if err != nil || k.key != "k2" || time.Since(start) < 50*time.Millisecond {
		t.Fatalf("key %v err %v after %s", k, err, time.Since(start))
	}
}

func TestSchedulerKeepsToTheDailyShare(t *testing.T) {
	s := newScheduler([]string{"k1"}, 1e9, 1e9, 10_000)
	k, err := s.acquire(context.Background(), 5000, 600, nil)
	if err != nil {
		t.Fatal(err)
	}
	s.settle(k, 0, 550) // the answer only used about 50
	if _, err := s.acquire(context.Background(), 4000, 300, nil); err != nil {
		t.Fatalf("unused share was not given back: %v", err)
	}

	// Out of share, a viewer hears to come back later instead of waiting.
	start := time.Now()
	_, err = s.acquire(context.Background(), 5000, 600, nil)
	wait, busy := busyFor(err)
	if !busy || wait < time.Hour || time.Since(start) > time.Second {
		t.Fatalf("wait %s busy %v after %s", wait, busy, time.Since(start))
	}
	if got := s.crowded(); got < time.Hour {
		t.Fatalf("crowded says %s", got)
	}

	// The share comes back over the day.
	k.day.at = k.day.at.Add(-13 * time.Hour)
	if _, err := s.acquire(context.Background(), 5000, 600, nil); err != nil {
		t.Fatalf("share did not refill: %v", err)
	}
}

func TestSchedulerGivesBackUnused(t *testing.T) {
	s := newScheduler([]string{"k1"}, 1e9, 1000, 1e9)
	k, _ := s.acquire(context.Background(), 1, 600, nil)
	s.settle(k, 0, 550) // the answer only used about 50
	if k.out.level < 940 {
		t.Fatalf("level %.0f", k.out.level)
	}
	if _, err := s.acquire(context.Background(), 1, 600, nil); err != nil {
		t.Fatalf("room was not given back: %v", err)
	}
}

func TestSchedulerTrustsGroqsCount(t *testing.T) {
	s := newScheduler([]string{"k1"}, 7000, 1000, 1e9)
	k := s.keys[0]
	s.observe(k, -1)
	s.observe(k, 9000)
	if k.in.level < 6999 || k.out.level < 999 {
		t.Fatalf("changed without cause: in %.0f out %.0f", k.in.level, k.out.level)
	}
	s.observe(k, 3000) // something else spent 5000 on this key
	if k.in.level > 2001 || k.out.level < 999 {
		t.Fatalf("in %.0f out %.0f", k.in.level, k.out.level)
	}
	s.observe(k, 400)
	if k.in.level > 1 || k.out.level > 401 || k.out.level < 399 {
		t.Fatalf("in %.0f out %.0f", k.in.level, k.out.level)
	}
}

func TestGroqReadsWhatAKeyHasLeft(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Ratelimit-Remaining-Tokens", "100")
		_, _ = w.Write([]byte(sse("ok")))
	}))
	defer srv.Close()
	g := NewGroq("k1", "m")
	g.endpoint = srv.URL
	if _, err := complete(context.Background(), g, nil, 10); err != nil {
		t.Fatal(err)
	}
	if k := g.sched.keys[0]; k.in.level > 1 || k.out.level > 120 {
		t.Fatalf("in %.0f out %.0f", k.in.level, k.out.level)
	}
}

func TestGroqSaysBusyWhenItKeepsRefusing(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "0.01")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"Rate limit reached for model m in organization org_private on output tokens per minute (OTPM): Limit 1000"}}`))
	}))
	defer srv.Close()
	g := NewGroq("k1,k2", "m")
	g.endpoint = srv.URL
	_, err := complete(context.Background(), g, nil, 10)
	wait, busy := busyFor(err)
	if !busy || wait < minBusyRetry || calls.Load() != maxRateLimits {
		t.Fatalf("err %v busy %v wait %s calls %d", err, busy, wait, calls.Load())
	}
	if msg := err.Error(); !strings.Contains(msg, "429 OTPM") || strings.Contains(msg, "org_") {
		t.Fatalf("error %q", msg)
	}
}

func TestUserSlots(t *testing.T) {
	u := newUserSlots(2, 50*time.Millisecond)
	if !u.take("a") || !u.take("a") || u.take("a") || !u.take("b") {
		t.Fatal("limit not kept per viewer")
	}
	u.give("a")
	if !u.take("a") {
		t.Fatal("a slot given back was not reused")
	}
	time.Sleep(60 * time.Millisecond)
	if !u.take("a") || !u.take("a") {
		t.Fatal("slots that were never given back did not expire")
	}
}

func asker(id, user, q string) map[string]any {
	return map[string]any{"uniqueId": id, "userId": user, "question": q}
}

func TestAskSharesFirstQuestions(t *testing.T) {
	h := newHarness(t, true)
	h.model.slow = 150 * time.Millisecond
	var wg sync.WaitGroup
	replies := make([]reply, 40)
	for i := range replies {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			q := "Summarize this video"
			if i%2 == 1 {
				q = "  summarize THIS video? " // the same question, typed differently
			}
			r, err := h.try(secret, asker(publicID, fmt.Sprintf("viewer%d", i), q))
			if err != nil {
				t.Error(err)
			}
			replies[i] = r
		}(i)
	}
	wg.Wait()
	for i, r := range replies {
		if r.code != http.StatusOK || r.text != replies[0].text || eventTypes(r) != eventTypes(replies[0]) || r.chat == "" {
			t.Fatalf("viewer %d: code %d events %q text %q", i, r.code, eventTypes(r), r.text)
		}
	}
	if n := len(h.model.calls); n != 1 {
		t.Fatalf("model called %d times for one question", n)
	}

	// Later viewers get it without a call, and it is remembered in their chat.
	later := h.ask(t, secret, asker(publicID, "late", "Summarize this video"))
	if later.text != replies[0].text || len(h.model.calls) != 1 {
		t.Fatalf("later viewer: calls %d text %q", len(h.model.calls), later.text)
	}
	follow := h.ask(t, secret, map[string]any{"uniqueId": publicID, "userId": "late", "question": "Summarize this video", "conversationId": later.chat})
	if len(h.model.calls) != 2 || follow.code != http.StatusOK {
		t.Fatalf("a follow up was shared: calls %d", len(h.model.calls))
	}
	if hist := h.model.last().Messages; len(hist) < 3 {
		t.Fatalf("follow up lost the shared answer from its chat: %d messages", len(hist))
	}

	// Another question, or another video, is its own answer.
	h.ask(t, secret, asker(publicID, "x", "Who is in it?"))
	h.ask(t, secret, asker(legacyID, "x", "Summarize this video"))
	if n := len(h.model.calls); n != 4 {
		t.Fatalf("model called %d times", n)
	}
}

func TestAskKeepsWritingForFollowersWhenTheFirstLeaves(t *testing.T) {
	h := newHarness(t, true)
	h.model.slow = 200 * time.Millisecond
	first := make(chan reply, 1)
	go func() {
		h2 := *h
		h2.timeout = 50 // the first asker gives up long before the answer
		r, _ := h2.try(secret, asker(publicID, "first", "Summarize this video"))
		first <- r
	}()
	time.Sleep(30 * time.Millisecond)
	r := h.ask(t, secret, asker(publicID, "second", "Summarize this video"))
	<-first
	if r.code != http.StatusOK || !strings.Contains(r.text, "frisbee") || eventTypes(r) != "c d done" || len(h.model.calls) != 1 {
		t.Fatalf("follower: events %q text %q calls %d", eventTypes(r), r.text, len(h.model.calls))
	}
}

type crowdedModel struct {
	*fakeModel
	wait time.Duration
}

func (m crowdedModel) crowded() time.Duration { return m.wait }

func TestAskTurnsAwayWhenCrowded(t *testing.T) {
	var model crowdedModel
	h := newHarness(t, true, func(c *Config) {
		model = crowdedModel{fakeModel: c.Model.(*fakeModel)}
		c.Model = &model
	})
	h.ask(t, secret, asker(publicID, "early", "Summarize this video"))

	model.wait = 45 * time.Second
	r := h.ask(t, secret, asker(publicID, "busy", "Who is in it?"))
	if r.code != http.StatusServiceUnavailable || r.err != "busy" || r.retry != 45 {
		t.Fatalf("code %d err %q retry %d", r.code, r.err, r.retry)
	}
	// Turned away before the quota was charged.
	for i := 0; i < int(askCaps[0].Limit); i++ {
		if ok, _, _ := h.caps.Take(context.Background(), "busy", askCaps...); !ok {
			t.Fatalf("the busy answer used up the viewer's quota at %d", i)
		}
	}
	// An answer someone already got still goes out while it's busy.
	if r := h.ask(t, secret, asker(publicID, "busy2", "Summarize this video")); r.code != http.StatusOK || eventTypes(r) != "c d done" {
		t.Fatalf("shared answer refused when busy: %d %q", r.code, eventTypes(r))
	}
}

func TestAskSaysBusyMidStream(t *testing.T) {
	h := newHarness(t, true)
	h.model.busy = 7 * time.Second
	r := h.ask(t, secret, question(publicID))
	last := r.events[len(r.events)-1]
	if eventTypes(r) != "c err" || last.V != "busy" || last.N != 7 {
		t.Fatalf("events %+v", r.events)
	}
}

func TestAskSurvivesAPanic(t *testing.T) {
	h := newHarness(t, true)
	h.model.panicky = true
	if r := h.ask(t, secret, question(publicID)); eventTypes(r) != "c err" {
		t.Fatalf("events %q", eventTypes(r))
	}
	h.model.panicky = false
	if r := h.ask(t, secret, asker(publicID, viewerID, "Who is in it?")); eventTypes(r) != "c d done" {
		t.Fatalf("the next question after a panic: %q", eventTypes(r))
	}
}

func TestAskOneViewerCantHogIt(t *testing.T) {
	h := newHarness(t, true)
	h.model.slow = 200 * time.Millisecond
	var wg sync.WaitGroup
	codes := make([]int, 5)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r, _ := h.try(secret, asker(publicID, "hog", fmt.Sprintf("Question %d", i)))
			codes[i] = r.code
		}(i)
	}
	wg.Wait()
	ok, refused := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusTooManyRequests:
			refused++
		}
	}
	if ok != maxAsksAtOnce || refused != len(codes)-maxAsksAtOnce {
		t.Fatalf("codes %v", codes)
	}
}

// TestAskUnderLoad sends a thousand viewers at once through the real Groq
// client against a stand in for Groq with two keys. Every viewer must get an
// answer or a clear busy, the popular questions must be answered once each,
// Groq must never see more than its keys allow, and nothing may be left
// running after.
func TestAskUnderLoad(t *testing.T) {
	if testing.Short() {
		t.Skip("load test")
	}
	var groqCalls, inFlight, peak atomic.Int64
	groq := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		groqCalls.Add(1)
		n := inFlight.Add(1)
		defer inFlight.Add(-1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(sse("It shows ", "a dog.")))
	}))
	defer groq.Close()
	model := NewGroq("k1,k2", "m")
	model.endpoint = groq.URL

	h := newHarness(t, true, func(c *Config) { c.Model = model })
	h.timeout = -1
	before := runtime.NumGoroutine()

	popular := []string{"Summarize this video", "What is said in it?", "What are the key moments?"}
	const viewers = 1000
	var wg sync.WaitGroup
	var answered, busy, other atomic.Int64
	var mu sync.Mutex
	texts := map[string]map[string]bool{}
	for i := 0; i < viewers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			q := popular[i%len(popular)]
			if i%10 == 0 {
				q = fmt.Sprintf("Is there a cat at %d seconds?", i) // a question nobody else asks
			}
			r, err := h.try(secret, asker(publicID, fmt.Sprintf("viewer%d", i), q))
			last := ""
			if n := len(r.events); n > 0 {
				last = r.events[n-1].T + ":" + r.events[n-1].V
			}
			switch {
			case err != nil:
				t.Errorf("viewer %d: %v", i, err)
				other.Add(1)
			case r.code == http.StatusOK && last == "done:":
				answered.Add(1)
				mu.Lock()
				if texts[q] == nil {
					texts[q] = map[string]bool{}
				}
				texts[q][r.text] = true
				mu.Unlock()
			case r.code == http.StatusServiceUnavailable && r.err == "busy" && r.retry > 0,
				r.code == http.StatusOK && last == "err:busy" && r.events[len(r.events)-1].N > 0:
				busy.Add(1)
			default:
				other.Add(1)
				t.Errorf("viewer %d: code %d err %q events %q", i, r.code, r.err, eventTypes(r))
			}
		}(i)
	}
	wg.Wait()

	t.Logf("%d viewers: %d answered, %d told busy, %d other; Groq saw %d calls, at most %d at once",
		viewers, answered.Load(), busy.Load(), other.Load(), groqCalls.Load(), peak.Load())
	if other.Load() != 0 {
		t.Fatalf("%d viewers got neither an answer nor a busy", other.Load())
	}
	for _, q := range popular {
		if len(texts[q]) > 1 {
			t.Fatalf("%q was answered %d different ways", q, len(texts[q]))
		}
	}
	// Each question reaches Groq at most once, however many asked it, and
	// only as many as the keys' budgets allow.
	distinct := int64(len(popular) + viewers/10)
	if answered.Load() == 0 || groqCalls.Load() > distinct || groqCalls.Load() > answered.Load() {
		t.Fatalf("answered %d, Groq calls %d", answered.Load(), groqCalls.Load())
	}

	// Nothing left running once every viewer is done, beyond a few idle
	// connections the HTTP clients keep.
	deadline := time.Now().Add(3 * time.Second)
	for runtime.NumGoroutine() > before+40 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if n := runtime.NumGoroutine(); n > before+40 {
		t.Fatalf("%d goroutines left running (started with %d)", n, before)
	}
}
