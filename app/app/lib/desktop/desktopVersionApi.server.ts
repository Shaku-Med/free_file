/**
 * Desktop version API helpers: TTL cache, in-flight coalesce, rate limits, soft queue.
 * Keeps get_active_desktop_version RPC off the hot path under stampede.
 */

import db from '~/lib/Database/supabase';
import { rateLimiter, RateLimiter } from '~/routes/Auth/fun/rateLimit';
import type { DesktopPlatform, DesktopVersionRow } from './desktopVersions.server';

const VERSION_TTL_MS = 90_000; // serve from memory for 90s
const VERSION_STALE_MS = 5 * 60_000; // on DB failure, keep serving stale up to 5m
const MAX_CURRENT_LEN = 32;

type CacheEntry = {
  row: DesktopVersionRow | null;
  fetchedAt: number;
};

const versionCache = new Map<DesktopPlatform, CacheEntry>();
const inFlight = new Map<DesktopPlatform, Promise<DesktopVersionRow | null>>();

/** Soft queue: cap concurrent GitHub installer fetches (downloads stampede). */
const MAX_INSTALLER_FETCHES = 2;
let installerFetchesActive = 0;
const installerFetchWaiters: Array<{
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];
const INSTALLER_QUEUE_WAIT_MS = 45_000;
const MAX_INSTALLER_WAITERS = 40;

export function sanitizeCurrentVersion(raw: string): string {
  const v = String(raw || '0.0.0').trim().slice(0, MAX_CURRENT_LEN);
  if (!v || !/^[\dvV][\w.+-]*$/.test(v)) return '0.0.0';
  return v;
}

export function invalidateDesktopVersionCache(platform?: DesktopPlatform): void {
  if (platform) versionCache.delete(platform);
  else versionCache.clear();
}

async function fetchActiveFromDb(platform: DesktopPlatform): Promise<DesktopVersionRow | null> {
  if (!db) throw new Error('Database unavailable');
  const { data, error } = await db.rpc('get_active_desktop_version', {
    p_platform: platform,
  });
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as DesktopVersionRow[];
  return rows[0] ?? null;
}

/**
 * Active desktop row for a platform, with TTL cache + single-flight coalesce.
 * Concurrent callers for the same platform share one DB round-trip.
 */
export async function getActiveDesktopVersionCached(
  platform: DesktopPlatform,
): Promise<DesktopVersionRow | null> {
  const now = Date.now();
  const hit = versionCache.get(platform);
  if (hit && now - hit.fetchedAt < VERSION_TTL_MS) {
    return hit.row;
  }

  const pending = inFlight.get(platform);
  if (pending) return pending;

  const job = (async () => {
    try {
      const row = await fetchActiveFromDb(platform);
      versionCache.set(platform, { row, fetchedAt: Date.now() });
      return row;
    } catch (e) {
      if (hit && now - hit.fetchedAt < VERSION_STALE_MS) {
        console.warn('[desktop] version DB failed; serving stale cache', platform);
        return hit.row;
      }
      throw e;
    } finally {
      inFlight.delete(platform);
    }
  })();

  inFlight.set(platform, job);
  return job;
}

async function acquireInstallerFetchSlot(): Promise<void> {
  if (installerFetchesActive < MAX_INSTALLER_FETCHES) {
    installerFetchesActive++;
    return;
  }
  if (installerFetchWaiters.length >= MAX_INSTALLER_WAITERS) {
    throw new Error('Download queue full — try again shortly');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = installerFetchWaiters.findIndex((w) => w.resolve === resolve);
      if (idx >= 0) installerFetchWaiters.splice(idx, 1);
      reject(new Error('Download queue timeout'));
    }, INSTALLER_QUEUE_WAIT_MS);
    installerFetchWaiters.push({ resolve, reject, timer });
  });
}

function releaseInstallerFetchSlot(): void {
  installerFetchesActive = Math.max(0, installerFetchesActive - 1);
  while (installerFetchesActive < MAX_INSTALLER_FETCHES && installerFetchWaiters.length) {
    const next = installerFetchWaiters.shift();
    if (!next) break;
    clearTimeout(next.timer);
    installerFetchesActive++;
    next.resolve();
  }
}

/** Wait in line for a GitHub→disk installer fetch slot (or timeout). */
export async function withInstallerFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireInstallerFetchSlot();
  try {
    return await fn();
  } finally {
    releaseInstallerFetchSlot();
  }
}

/** Version check: generous (every app launch). */
export function checkDesktopVersionRateLimit(request: Request): {
  allowed: boolean;
  error?: string;
  retryAfterSec?: number;
} {
  const ip = RateLimiter.getClientIP(request);
  const r = rateLimiter.checkLimit(ip, 'desktop-version', 60, 5 * 60_000, 5 * 60_000);
  if (!r.allowed) {
    const retryAfterSec = r.blockedUntil
      ? Math.max(1, Math.ceil((r.blockedUntil - Date.now()) / 1000))
      : 60;
    return { allowed: false, error: r.error || 'Too many version checks', retryAfterSec };
  }
  return { allowed: true };
}

/** Installer download: stricter (large payloads). */
export function checkDesktopDownloadRateLimit(request: Request): {
  allowed: boolean;
  error?: string;
  retryAfterSec?: number;
} {
  const ip = RateLimiter.getClientIP(request);
  const r = rateLimiter.checkLimit(ip, 'desktop-download', 12, 15 * 60_000, 15 * 60_000);
  if (!r.allowed) {
    const retryAfterSec = r.blockedUntil
      ? Math.max(1, Math.ceil((r.blockedUntil - Date.now()) / 1000))
      : 120;
    return { allowed: false, error: r.error || 'Too many downloads', retryAfterSec };
  }
  return { allowed: true };
}

/** Reject obviously abusive query shapes before any DB work. */
export function assertDesktopVersionRequest(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }
  if (request.url.length > 512) {
    return Response.json({ success: false, error: 'Bad request' }, { status: 400 });
  }
  return null;
}
