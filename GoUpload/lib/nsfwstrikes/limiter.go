package nsfwstrikes

import (
	"context"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

const keyPrefix = "goupload:nsfw_strikes:"

type Limiter struct {
	rdb    *redis.Client
	max    int
	window time.Duration
}

func New(rdb *redis.Client, maxStrikes int, window time.Duration) *Limiter {
	return &Limiter{rdb: rdb, max: maxStrikes, window: window}
}

func (l *Limiter) Enabled() bool {
	return l != nil && l.rdb != nil && l.max > 0 && l.window > 0
}

func (l *Limiter) key(userID string) string {
	return keyPrefix + userID
}

func (l *Limiter) Blocked(ctx context.Context, userID string) (bool, error) {
	if !l.Enabled() || userID == "" {
		return false, nil
	}
	n, err := l.rdb.Get(ctx, l.key(userID)).Int()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return n >= l.max, nil
}

func (l *Limiter) RecordDeniedNSFW(ctx context.Context, userID string) error {
	if !l.Enabled() || userID == "" {
		return nil
	}
	k := l.key(userID)
	n, err := l.rdb.Incr(ctx, k).Result()
	if err != nil {
		return err
	}
	if n == 1 {
		return l.rdb.Expire(ctx, k, l.window).Err()
	}
	return nil
}

func (l *Limiter) RecordDeniedNSFWBestEffort(parent context.Context, userID string) error {
	if !l.Enabled() || userID == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	return l.RecordDeniedNSFW(ctx, userID)
}

func (l *Limiter) RespondIfBlocked(c *fiber.Ctx, userID string) bool {
	if !l.Enabled() || userID == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(c.UserContext(), 2*time.Second)
	defer cancel()
	blocked, err := l.Blocked(ctx, userID)
	if err != nil {
		return false
	}
	if !blocked {
		return false
	}
	retryAfter := int(l.window.Seconds())
	if ttl, err := l.rdb.TTL(ctx, l.key(userID)).Result(); err == nil && ttl > 0 {
		retryAfter = int(ttl.Round(time.Second).Seconds())
		if retryAfter < 1 {
			retryAfter = 1
		}
	}
	c.Set("Retry-After", strconv.Itoa(retryAfter))
	_ = c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
		"error":           "Too many images were flagged in a short time. Please try again later.",
		"nsfw_quota":      true,
		"retry_after_sec": retryAfter,
	})
	return true
}
