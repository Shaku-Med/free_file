// Package usercap counts how often each account does something that costs
// money, like a Google Vision check or a new upload, and stops it past a fixed
// number per window. Counts live in Redis so restarts don't reset them.
package usercap

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

type Window struct {
	Name  string
	Limit int64
	Per   time.Duration
}

// Store is the slice of Redis the limiter needs.
type Store interface {
	Incr(ctx context.Context, key string) (int64, error)
	Decr(ctx context.Context, key string) error
	PExpire(ctx context.Context, key string, d time.Duration) error
	PTTL(ctx context.Context, key string) (time.Duration, error)
}

type Limiter struct {
	store Store
}

func New(rdb *redis.Client) *Limiter {
	if rdb == nil {
		return nil
	}
	return &Limiter{store: redisStore{rdb}}
}

func NewWithStore(s Store) *Limiter { return &Limiter{store: s} }

var errNoLimiter = errors.New("usercap: not configured")

// Take counts one use against every window. When any of them is already full
// nothing is counted and the wait until it frees comes back. An error means
// the count is unknown, and callers refuse rather than run an unmetered call.
func (l *Limiter) Take(ctx context.Context, userID string, windows ...Window) (bool, time.Duration, error) {
	if l == nil || l.store == nil {
		return false, 0, errNoLimiter
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	var taken []string
	refund := func() {
		for _, k := range taken {
			_ = l.store.Decr(ctx, k)
		}
	}
	for _, w := range windows {
		key := "goupload:cap:" + w.Name + ":" + userID
		n, err := l.store.Incr(ctx, key)
		if err != nil {
			refund()
			return false, 0, err
		}
		taken = append(taken, key)
		if n == 1 {
			if err := l.store.PExpire(ctx, key, w.Per); err != nil {
				refund()
				return false, 0, err
			}
		}
		if n > w.Limit {
			wait, err := l.store.PTTL(ctx, key)
			// A key left without an expiry would never reset; give it one.
			if err == nil && wait <= 0 {
				_ = l.store.PExpire(ctx, key, w.Per)
				wait = w.Per
			}
			refund()
			return false, wait, nil
		}
	}
	return true, 0, nil
}

// Allow takes one use for the request's user and answers the request itself
// when it may not go ahead, returning false. code is the error the client sees
// on a 429.
func (l *Limiter) Allow(c *fiber.Ctx, userID, code string, windows ...Window) bool {
	ok, wait, err := l.Take(c.UserContext(), userID, windows...)
	if err != nil {
		c.Set("Retry-After", "30")
		_ = c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "error": "busy"})
		return false
	}
	if !ok {
		secs := int(wait.Round(time.Second) / time.Second)
		if secs < 1 {
			secs = 1
		}
		c.Set("Retry-After", strconv.Itoa(secs))
		_ = c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{"success": false, "error": code, "retry_after": secs})
		return false
	}
	return true
}

type redisStore struct{ rdb *redis.Client }

func (s redisStore) Incr(ctx context.Context, key string) (int64, error) {
	return s.rdb.Incr(ctx, key).Result()
}

func (s redisStore) Decr(ctx context.Context, key string) error {
	return s.rdb.Decr(ctx, key).Err()
}

func (s redisStore) PExpire(ctx context.Context, key string, d time.Duration) error {
	return s.rdb.PExpire(ctx, key, d).Err()
}

func (s redisStore) PTTL(ctx context.Context, key string) (time.Duration, error) {
	return s.rdb.PTTL(ctx, key).Result()
}
