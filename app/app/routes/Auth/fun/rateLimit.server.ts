/**
 * Rate limiting for auth and API endpoints, per IP or identifier.
 *
 * Counts live in the shared store (Redis), so every copy of the app enforces
 * the same limit. When the store can't answer the request is refused.
 */

import { clientIpBucket } from '~/lib/Security/clientIp';
import { clearKeys, digest, hitWindow, setValue } from '~/lib/kv.server';

export type RateLimitResult = {
  allowed: boolean;
  remaining?: number;
  resetAt?: number;
  blockedUntil?: number;
  error?: string;
};

const ACTION_RE = /^[a-z0-9_-]{1,64}$/i;

function minutes(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return `${m} minute${m !== 1 ? 's' : ''}`;
}

export class RateLimiter {
  private keys(identifier: string, action: string) {
    const id = digest(identifier);
    return { count: `rl:${action}:${id}`, block: `rlb:${action}:${id}` };
  }

  /**
   * Check if a request should be rate limited
   * @param identifier - IP address or user identifier
   * @param action - Action type (login, signup, reset, verify, resend)
   * @param maxRequests - Maximum requests allowed in the window
   * @param windowMs - Time window in milliseconds
   * @param blockDurationMs - Duration to block after exceeding limit (optional)
   * @returns Object with allowed status and remaining time
   */
  async checkLimit(
    identifier: string,
    action: string,
    maxRequests: number = 5,
    windowMs: number = 15 * 60 * 1000, // 15 minutes default
    blockDurationMs: number = 30 * 60 * 1000 // 30 minutes block
  ): Promise<RateLimitResult> {
    if (!ACTION_RE.test(action)) throw new Error(`bad rate limit action ${action}`);
    const keys = this.keys(identifier, action);
    const now = Date.now();
    try {
      const hit = await hitWindow(keys.count, keys.block, windowMs);
      if (hit.blockedMs > 0) {
        return {
          allowed: false,
          blockedUntil: now + hit.blockedMs,
          error: `Too many requests. Please try again in ${minutes(hit.blockedMs)}.`,
        };
      }
      if (hit.count > maxRequests) {
        if (blockDurationMs > 0) await setValue(keys.block, '1', blockDurationMs);
        const wait = blockDurationMs > 0 ? blockDurationMs : hit.resetMs;
        return {
          allowed: false,
          blockedUntil: now + wait,
          error: `Rate limit exceeded. Please try again in ${minutes(wait)}.`,
        };
      }
      return { allowed: true, remaining: maxRequests - hit.count, resetAt: now + hit.resetMs };
    } catch (e) {
      console.error(`[rateLimit] store unavailable, refusing ${action}:`, e instanceof Error ? e.message : e);
      return { allowed: false, error: 'Something went wrong. Please try again in a moment.' };
    }
  }

  /**
   * Reset rate limit for an identifier (useful for successful operations)
   */
  async reset(identifier: string, action: string): Promise<void> {
    const keys = this.keys(identifier, action);
    try {
      await clearKeys(keys.count, keys.block);
    } catch {
      // The window simply runs out on its own.
    }
  }

  /**
   * Rate-limit bucket for the caller's IP.
   *
   * Uses the trusted resolver, NOT the raw leftmost X-Forwarded-For entry: that
   * header is client-supplied, so reading it naively let anyone mint a fresh
   * bucket per request and bypass every IP-keyed limit here. Unresolvable IPs
   * collapse to a single shared "unknown" bucket (fails closed / grouped rather
   * than skipping the limit).
   */
  static getClientIP(request: Request): string {
    return clientIpBucket(request);
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

// Rate limit configurations for different actions
export const RATE_LIMITS = {
  login: { maxRequests: 5, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // 5 attempts per 15 min, 30 min block (per identifier)
  login_ip: { maxRequests: 30, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // per-IP cap to stop password spraying across accounts (generous for shared NAT)
  passkey: { maxRequests: 15, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 },
  signup: { maxRequests: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }, // 3 attempts per hour, 1 hour block (per email)
  // Per-IP signup cap: the per-email limit above can't stop one host creating
  // endless accounts by simply varying the address. Generous enough for shared
  // NAT (a household/campus), tight enough to stop bulk registration.
  signup_ip: { maxRequests: 10, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 },
  reset: { maxRequests: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }, // 3 attempts per hour, 1 hour block
  // Per-IP reset cap for the same reason (per-identifier limit alone lets one
  // host spray reset emails across many accounts).
  reset_ip: { maxRequests: 10, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 },
  verify: { maxRequests: 10, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // 10 attempts per 15 min, 30 min block
  resend: { maxRequests: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }, // 3 resends per hour, 1 hour block
} as const;

/**
 * Check rate limit for an auth action
 */
export function checkAuthRateLimit(
  request: Request,
  action: keyof typeof RATE_LIMITS,
  identifier?: string
): Promise<RateLimitResult> {
  const ip = RateLimiter.getClientIP(request);
  const id = identifier || ip;
  const config = RATE_LIMITS[action];
  
  return rateLimiter.checkLimit(
    id,
    action,
    config.maxRequests,
    config.windowMs,
    config.blockDurationMs
  );
}

/**
 * Reset rate limit after successful operation
 */
export function resetAuthRateLimit(
  request: Request,
  action: keyof typeof RATE_LIMITS,
  identifier?: string
): Promise<void> {
  const ip = RateLimiter.getClientIP(request);
  const id = identifier || ip;
  return rateLimiter.reset(id, action);
}
