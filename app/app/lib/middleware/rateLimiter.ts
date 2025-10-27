interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (request: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
      }
    }
  }

  private getKey(request: Request, keyGenerator?: (request: Request) => string): string {
    if (keyGenerator) {
      return keyGenerator(request);
    }
    
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : 
               request.headers.get('x-real-ip') || 
               'unknown';
    
    return `rate_limit:${ip}`;
  }

  checkLimit(request: Request, config: RateLimitConfig): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  } {
    const key = this.getKey(request, config.keyGenerator);
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    let entry = this.store.get(key);
    
    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs
      };
    }
    
    if (entry.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
        retryAfter: Math.ceil((entry.resetTime - now) / 1000)
      };
    }
    
    entry.count++;
    this.store.set(key, entry);
    
    return {
      allowed: true,
      remaining: config.maxRequests - entry.count,
      resetTime: entry.resetTime,
      retryAfter: undefined
    };
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

const rateLimiter = new RateLimiter();

export function createRateLimit(config: RateLimitConfig) {
  return async (request: Request, next: () => Promise<Response>): Promise<Response> => {
    const result = rateLimiter.checkLimit(request, config);
    
    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          retryAfter: result.retryAfter
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': config.maxRequests.toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
            'Retry-After': result.retryAfter?.toString() || '0'
          }
        }
      );
    }
    
    const response = await next();
    
    response.headers.set('X-RateLimit-Limit', config.maxRequests.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    response.headers.set('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
    
    return response;
  };
}

export const rateLimitConfigs = {
  upload: {
    windowMs: 60 * 1000,
    maxRequests: 50,
    keyGenerator: (request: Request) => {
      const forwarded = request.headers.get('x-forwarded-for');
      const ip = forwarded ? forwarded.split(',')[0] : 
                 request.headers.get('x-real-ip') || 
                 'unknown';
      return `upload:${ip}`;
    }
  },
  likes: {
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyGenerator: (request: Request) => {
      const forwarded = request.headers.get('x-forwarded-for');
      const ip = forwarded ? forwarded.split(',')[0] : 
                 request.headers.get('x-real-ip') || 
                 'unknown';
      return `likes:${ip}`;
    }
  },
  api: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyGenerator: (request: Request) => {
      const forwarded = request.headers.get('x-forwarded-for');
      const ip = forwarded ? forwarded.split(',')[0] : 
                 request.headers.get('x-real-ip') || 
                 'unknown';
      return `api:${ip}`;
    }
  },
  strict: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    keyGenerator: (request: Request) => {
      const forwarded = request.headers.get('x-forwarded-for');
      const ip = forwarded ? forwarded.split(',')[0] : 
                 request.headers.get('x-real-ip') || 
                 'unknown';
      return `strict:${ip}`;
    }
  }
};

export { rateLimiter };
