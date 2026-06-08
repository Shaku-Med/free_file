/**
 * Rate limiting utility for auth endpoints
 * Prevents spam and abuse by tracking requests per IP/identifier
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
  blockedUntil?: number;
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now && (!entry.blockedUntil || entry.blockedUntil < now)) {
        this.store.delete(key);
      }
    }
  }

  private getKey(identifier: string, action: string): string {
    return `${action}:${identifier}`;
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
  checkLimit(
    identifier: string,
    action: string,
    maxRequests: number = 5,
    windowMs: number = 15 * 60 * 1000, // 15 minutes default
    blockDurationMs: number = 30 * 60 * 1000 // 30 minutes block
  ): { allowed: boolean; remaining?: number; resetAt?: number; blockedUntil?: number; error?: string } {
    const key = this.getKey(identifier, action);
    const now = Date.now();
    const entry = this.store.get(key);

    // Check if currently blocked
    if (entry?.blockedUntil && entry.blockedUntil > now) {
      const remainingBlock = Math.ceil((entry.blockedUntil - now) / 1000 / 60);
      return {
        allowed: false,
        blockedUntil: entry.blockedUntil,
        error: `Too many requests. Please try again in ${remainingBlock} minute${remainingBlock !== 1 ? 's' : ''}.`
      };
    }

    // Reset if window expired
    if (!entry || entry.resetAt < now) {
      this.store.set(key, {
        count: 1,
        resetAt: now + windowMs
      });
      return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
    }

    // Check if limit exceeded
    if (entry.count >= maxRequests) {
      const blockedUntil = now + blockDurationMs;
      entry.blockedUntil = blockedUntil;
      this.store.set(key, entry);
      const remainingBlock = Math.ceil(blockDurationMs / 1000 / 60);
      return {
        allowed: false,
        blockedUntil,
        error: `Rate limit exceeded. Please try again in ${remainingBlock} minute${remainingBlock !== 1 ? 's' : ''}.`
      };
    }

    // Increment count
    entry.count++;
    this.store.set(key, entry);

    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.resetAt
    };
  }

  /**
   * Reset rate limit for an identifier (useful for successful operations)
   */
  reset(identifier: string, action: string): void {
    const key = this.getKey(identifier, action);
    this.store.delete(key);
  }

  /**
   * Get client IP from request
   */
  static getClientIP(request: Request): string {
    // Check various headers for IP address
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    
    const realIP = request.headers.get('x-real-ip');
    if (realIP) {
      return realIP;
    }

    // Fallback to a default identifier if IP cannot be determined
    return 'unknown';
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

// Rate limit configurations for different actions
export const RATE_LIMITS = {
  login: { maxRequests: 5, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // 5 attempts per 15 min, 30 min block (per identifier)
  login_ip: { maxRequests: 30, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 }, // per-IP cap to stop password spraying across accounts (generous for shared NAT)
  passkey: { maxRequests: 15, windowMs: 15 * 60 * 1000, blockDurationMs: 30 * 60 * 1000 },
  signup: { maxRequests: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }, // 3 attempts per hour, 1 hour block
  reset: { maxRequests: 3, windowMs: 60 * 60 * 1000, blockDurationMs: 60 * 60 * 1000 }, // 3 attempts per hour, 1 hour block
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
): { allowed: boolean; remaining?: number; resetAt?: number; error?: string } {
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
): void {
  const ip = RateLimiter.getClientIP(request);
  const id = identifier || ip;
  rateLimiter.reset(id, action);
}
