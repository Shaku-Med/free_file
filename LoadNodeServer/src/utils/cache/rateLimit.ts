// Simple fixed-window per-IP limiter. In-memory only — fine for a single
// instance / warm Vercel function. Bump to Redis if you scale horizontally.

import type { Request, Response, NextFunction } from 'express';

// Lightweight inline IP extraction — the project's getClientIP is async and
// pulls in a regex check we don't need on the hot path.
function extractIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length > 0) return real;
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0) return cf;
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// LOAD_RATE_LIMIT_RPM=0 disables the limiter.
const RPM = parseIntEnv('LOAD_RATE_LIMIT_RPM', 600);
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 50_000;

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  if (RPM === 0) {
    next();
    return;
  }

  const ip = extractIp(req);
  const now = Date.now();
  let bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }

  bucket.count++;

  // Cap memory if the bucket map grows unbounded under a botnet.
  if (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (oldest) buckets.delete(oldest);
  }

  if (bucket.count > RPM) {
    res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    res.status(429).send(null);
    return;
  }

  next();
}
