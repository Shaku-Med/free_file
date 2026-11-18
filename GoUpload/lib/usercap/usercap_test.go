package usercap

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeStore struct {
	n      map[string]int64
	ttl    map[string]time.Duration
	failOn string
}

func newFake() *fakeStore {
	return &fakeStore{n: map[string]int64{}, ttl: map[string]time.Duration{}}
}

func (f *fakeStore) Incr(_ context.Context, k string) (int64, error) {
	if f.failOn == k {
		return 0, errors.New("redis down")
	}
	f.n[k]++
	return f.n[k], nil
}

func (f *fakeStore) Decr(_ context.Context, k string) error { f.n[k]--; return nil }

func (f *fakeStore) PExpire(_ context.Context, k string, d time.Duration) error {
	f.ttl[k] = d
	return nil
}

func (f *fakeStore) PTTL(_ context.Context, k string) (time.Duration, error) {
	if d, ok := f.ttl[k]; ok {
		return d, nil
	}
	return -1, nil
}

var windows = []Window{
	{Name: "h", Limit: 2, Per: time.Hour},
	{Name: "d", Limit: 3, Per: 24 * time.Hour},
}

func take(t *testing.T, l *Limiter, user string) (bool, time.Duration) {
	t.Helper()
	ok, wait, err := l.Take(context.Background(), user, windows...)
	if err != nil {
		t.Fatal(err)
	}
	return ok, wait
}

func TestTakeStopsAtTheLimit(t *testing.T) {
	f := newFake()
	l := NewWithStore(f)
	for i := 0; i < 2; i++ {
		if ok, _ := take(t, l, "u"); !ok {
			t.Fatalf("use %d refused", i+1)
		}
	}
	ok, wait := take(t, l, "u")
	if ok || wait != time.Hour {
		t.Fatalf("third use in the hour: ok=%v wait=%s, want refused for an hour", ok, wait)
	}
	if f.n["goupload:cap:h:u"] != 2 || f.n["goupload:cap:d:u"] != 2 {
		t.Fatalf("a refused use was counted: %v", f.n)
	}
	if ok, _ := take(t, l, "other"); !ok {
		t.Fatal("another account has its own count")
	}
}

func TestTakeSetsTheWindowOnce(t *testing.T) {
	f := newFake()
	l := NewWithStore(f)
	take(t, l, "u")
	f.ttl["goupload:cap:h:u"] = time.Minute
	take(t, l, "u")
	if f.ttl["goupload:cap:h:u"] != time.Minute {
		t.Fatal("a later use must not push the window back")
	}
}

func TestTakeRepairsAKeyWithoutExpiry(t *testing.T) {
	f := newFake()
	l := NewWithStore(f)
	f.n["goupload:cap:h:u"] = 5
	ok, wait := take(t, l, "u")
	if ok || wait != time.Hour || f.ttl["goupload:cap:h:u"] != time.Hour {
		t.Fatalf("ok=%v wait=%s ttl=%s, want the stuck key to get its hour back", ok, wait, f.ttl["goupload:cap:h:u"])
	}
}

func TestTakeFailsClosed(t *testing.T) {
	f := newFake()
	f.failOn = "goupload:cap:d:u"
	l := NewWithStore(f)
	ok, _, err := l.Take(context.Background(), "u", windows...)
	if err == nil || ok {
		t.Fatal("an unknown count must refuse")
	}
	if f.n["goupload:cap:h:u"] != 0 {
		t.Fatal("the window counted before the failure must be given back")
	}
	var none *Limiter
	if ok, _, err := none.Take(context.Background(), "u", windows...); err == nil || ok {
		t.Fatal("a missing limiter must refuse, not wave everything through")
	}
}
