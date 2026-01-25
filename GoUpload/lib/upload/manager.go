package upload

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"sync"
	"time"
)

var (
	ErrNotFound     = errors.New("upload_not_found")
	ErrRange        = errors.New("invalid_range")
	ErrTooLarge     = errors.New("upload_too_large")
	ErrSizeMismatch = errors.New("size_mismatch")
)

type session struct {
	id        string
	size      int64
	received  int64
	buffer    *bytes.Buffer
	updatedAt time.Time
}

type manager struct {
	mu       sync.Mutex
	sessions map[string]*session
	maxSize  int64
	ttl      time.Duration
}

func newManager(maxSize int64, ttl time.Duration) *manager {
	if maxSize <= 0 {
		maxSize = 50 << 20
	}
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &manager{
		sessions: make(map[string]*session),
		maxSize:  maxSize,
		ttl:      ttl,
	}
}

func (m *manager) start(size int64) (*session, error) {
	if size <= 0 || size > m.maxSize {
		return nil, ErrTooLarge
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupLocked()
	id := randomID()
	s := &session{
		id:        id,
		size:      size,
		received:  0,
		buffer:    &bytes.Buffer{},
		updatedAt: time.Now(),
	}
	m.sessions[id] = s
	return s, nil
}

func (m *manager) appendChunk(id string, r io.Reader, start, end, total int64) (*session, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupLocked()
	s, ok := m.sessions[id]
	if !ok {
		return nil, false, ErrNotFound
	}
	if total != s.size || start != s.received || end < start {
		return nil, false, ErrRange
	}
	expected := end - start + 1
	if s.received+expected > s.size {
		return nil, false, ErrSizeMismatch
	}
	written, err := io.CopyN(s.buffer, r, expected)
	if err != nil {
		return nil, false, err
	}
	if written != expected {
		return nil, false, ErrSizeMismatch
	}
	s.received += written
	s.updatedAt = time.Now()
	complete := s.received == s.size
	if complete {
		delete(m.sessions, id)
	}
	return s, complete, nil
}

func (m *manager) uploadSingle(r io.Reader, size int64) (*session, error) {
	if size > m.maxSize {
		return nil, ErrTooLarge
	}
	m.mu.Lock()
	m.cleanupLocked()
	id := randomID()
	s := &session{
		id:        id,
		size:      size,
		received:  0,
		buffer:    &bytes.Buffer{},
		updatedAt: time.Now(),
	}
	m.sessions[id] = s
	m.mu.Unlock()

	limit := m.maxSize + 1
	if size > 0 {
		limit = size
	}
	written, err := io.CopyN(s.buffer, r, limit)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if size > 0 && written != size {
		return nil, ErrSizeMismatch
	}
	if size <= 0 && written > m.maxSize {
		return nil, ErrTooLarge
	}
	m.mu.Lock()
	s.received = written
	s.size = written
	s.updatedAt = time.Now()
	delete(m.sessions, id)
	m.mu.Unlock()

	return s, nil
}

func (m *manager) cleanupLocked() {
	if len(m.sessions) == 0 {
		return
	}
	exp := time.Now().Add(-m.ttl)
	for id, s := range m.sessions {
		if s.updatedAt.Before(exp) {
			delete(m.sessions, id)
		}
	}
}

func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b)
}
