package askvideo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Viewers of a popular video tend to open a chat with the same question, the
// suggestion chips above all. Each such question is answered once: anyone who
// asks while it is being written follows along live, and anyone after gets it
// straight away, so the model's small free quota goes to new questions.
//
// Only a chat's first question is shared. Nothing in its prompt is about the
// viewer, only the public video and the question.
const (
	sharedTTL = 6 * time.Hour
	sharedMax = 1000
)

type sharedAnswers struct {
	mu   sync.Mutex
	live map[string]*broadcast
	done map[string]*broadcast
}

func newSharedAnswers() *sharedAnswers {
	return &sharedAnswers{live: map[string]*broadcast{}, done: map[string]*broadcast{}}
}

// broadcast is one answer as it is written, for everyone asking the same thing.
type broadcast struct {
	mu          sync.Mutex
	events      []event
	finished    bool
	ok          bool
	followers   int
	fingerprint string
	expires     time.Time
	changed     chan struct{}
}

// sharedKey names a first question about a video.
func sharedKey(uniqueID, question string) string {
	return hashParts(uniqueID, normalizeQuestion(question))
}

// videoFingerprint changes when anything an answer is built on changes: a new
// title, description, captions or song makes a new answer.
func videoFingerprint(v *video) string {
	parts := []string{v.Title, v.Description, v.AIDescription, strings.Join(v.Tags, ","), v.Transcript, v.Uploader}
	if v.Song != nil {
		parts = append(parts, v.Song.Title, v.Song.Artists)
	}
	if v.Frames != nil {
		parts = append(parts, strconv.Itoa(len(v.Frames.Times)))
	}
	return hashParts(parts...)
}

func hashParts(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func normalizeQuestion(q string) string {
	return strings.TrimRight(strings.ToLower(strings.Join(strings.Fields(q), " ")), " ?!.")
}

// has reports an answer being written or ready to hand out, before the video
// is loaded to check it still matches.
func (s *sharedAnswers) has(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.live[key]; ok {
		return true
	}
	b, ok := s.done[key]
	return ok && time.Now().Before(b.expires)
}

// join returns the answer to follow, or lead when the caller asks first and
// must write it.
func (s *sharedAnswers) join(key, fingerprint string) (b *broadcast, lead bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if b, ok := s.done[key]; ok {
		if time.Now().Before(b.expires) && b.fingerprint == fingerprint {
			return b, false
		}
		delete(s.done, key)
	}
	if b, ok := s.live[key]; ok && b.fingerprint == fingerprint {
		return b, false
	}
	b = &broadcast{fingerprint: fingerprint, changed: make(chan struct{})}
	s.live[key] = b
	return b, true
}

// finish ends a lead answer. A good one is kept, in one piece, for later.
func (s *sharedAnswers) finish(key string, b *broadcast, ok bool) {
	b.mu.Lock()
	b.finished, b.ok = true, ok
	close(b.changed)
	kept := &broadcast{finished: true, ok: true, events: compact(b.events), fingerprint: b.fingerprint, changed: b.changed}
	b.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	// A newer answer may have taken the spot after the video changed.
	if s.live[key] != b {
		return
	}
	delete(s.live, key)
	if !ok {
		return
	}
	now := time.Now()
	if len(s.done) >= sharedMax {
		oldest := ""
		for k, d := range s.done {
			if !now.Before(d.expires) {
				delete(s.done, k)
				continue
			}
			if oldest == "" || d.expires.Before(s.done[oldest].expires) {
				oldest = k
			}
		}
		if len(s.done) >= sharedMax {
			delete(s.done, oldest)
		}
	}
	kept.expires = now.Add(sharedTTL)
	s.done[key] = kept
}

func (b *broadcast) add(ev event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.finished {
		return
	}
	b.events = append(b.events, ev)
	close(b.changed)
	b.changed = make(chan struct{})
}

// watched reports whether anyone is following, which keeps an answer going
// after the viewer who asked first has left.
func (b *broadcast) watched() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.followers > 0
}

// follow sends the answer's events as they come and reports whether it
// finished well.
func (b *broadcast) follow(ctx context.Context, send func(event) error) (bool, error) {
	b.mu.Lock()
	b.followers++
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		b.followers--
		b.mu.Unlock()
	}()
	next := 0
	for {
		b.mu.Lock()
		pending := b.events[next:]
		next = len(b.events)
		finished, ok, changed := b.finished, b.ok, b.changed
		b.mu.Unlock()
		for _, ev := range pending {
			if err := send(ev); err != nil {
				return false, err
			}
		}
		if finished {
			return ok, nil
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return false, ctx.Err()
		}
	}
}

// compact keeps what a later viewer needs: lookups, sources and the text,
// joined into as few pieces as the order allows.
func compact(events []event) []event {
	var out []event
	for _, ev := range events {
		switch ev.T {
		case "d":
			if n := len(out); n > 0 && out[n-1].T == "d" {
				out[n-1].V += ev.V
				continue
			}
			out = append(out, ev)
		case "s", "r", "cut":
			out = append(out, ev)
		}
	}
	return out
}
