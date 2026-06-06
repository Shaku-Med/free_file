// Samples RSS + event-loop lag every N seconds; evicts the cache under pressure.

import { monitorEventLoopDelay } from 'perf_hooks';
import { getMemoryCache } from './memoryCache.js';

type EventLoopDelayMonitor = ReturnType<typeof monitorEventLoopDelay>;

interface MonitorConfig {
  intervalMs: number;
  softRssBytes: number;
  hardRssBytes: number;
  warmLagMs: number;
  hotLagMs: number;
  cooldownMs: number;
}

let timer: NodeJS.Timeout | null = null;
let lagMonitor: EventLoopDelayMonitor | null = null;
let lastEvictionAt = 0;
let lastFlushAt = 0;
let snapshotsTaken = 0;
let snapshotsTriggered = 0;
let lastSnapshot: ReturnType<typeof buildSnapshot> | null = null;

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function readConfig(): MonitorConfig {
  return {
    intervalMs: parseEnvInt('LOAD_MONITOR_INTERVAL_MS', 10_000),
    softRssBytes: parseEnvInt('LOAD_MONITOR_SOFT_RSS_BYTES', 512 * 1024 * 1024),
    hardRssBytes: parseEnvInt('LOAD_MONITOR_HARD_RSS_BYTES', 768 * 1024 * 1024),
    warmLagMs: parseEnvInt('LOAD_MONITOR_WARM_LAG_MS', 100),
    hotLagMs: parseEnvInt('LOAD_MONITOR_HOT_LAG_MS', 250),
    cooldownMs: parseEnvInt('LOAD_MONITOR_COOLDOWN_MS', 30_000),
  };
}

function buildSnapshot() {
  const mem = process.memoryUsage();
  return {
    at: new Date().toISOString(),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    externalBytes: mem.external,
    eventLoopLagMeanMs: lagMonitor ? Math.round(lagMonitor.mean / 1e6) : 0,
    eventLoopLagMaxMs: lagMonitor ? Math.round(lagMonitor.max / 1e6) : 0,
    cache: getMemoryCache().stats(),
  };
}

// Idempotent. LOAD_MONITOR_DISABLE=1 turns it off.
export function startLoadMonitor(): void {
  if (timer !== null) return;
  if (process.env.LOAD_MONITOR_DISABLE === '1') {
    console.log('[loadMonitor] disabled via LOAD_MONITOR_DISABLE=1');
    return;
  }

  lagMonitor = monitorEventLoopDelay({ resolution: 20 });
  lagMonitor.enable();

  const cfg = readConfig();
  console.log(
    `[loadMonitor] started interval=${cfg.intervalMs}ms soft_rss=${cfg.softRssBytes} hard_rss=${cfg.hardRssBytes}`,
  );

  timer = setInterval(() => {
    snapshotsTaken++;
    const snap = buildSnapshot();
    lastSnapshot = snap;
    lagMonitor?.reset();

    const now = Date.now();
    const onCooldown = now - lastEvictionAt < cfg.cooldownMs;

    const hot = snap.eventLoopLagMeanMs >= cfg.hotLagMs || snap.rssBytes >= cfg.hardRssBytes;
    const warm = snap.eventLoopLagMeanMs >= cfg.warmLagMs || snap.rssBytes >= cfg.softRssBytes;

    if (hot) {
      if (now - lastFlushAt < cfg.cooldownMs) return;
      const cache = getMemoryCache();
      const freed = cache.stats().bytes;
      cache.clear();
      lastFlushAt = now;
      lastEvictionAt = now;
      snapshotsTriggered++;
      console.warn(`[loadMonitor] FLUSH rss=${snap.rssBytes} lag=${snap.eventLoopLagMeanMs}ms freed=${freed}`);
      return;
    }

    if (warm && !onCooldown) {
      const dropped = getMemoryCache().evictFraction(0.3);
      lastEvictionAt = now;
      snapshotsTriggered++;
      console.warn(`[loadMonitor] evicted 30% entries=${dropped} rss=${snap.rssBytes} lag=${snap.eventLoopLagMeanMs}ms`);
    }
  }, cfg.intervalMs);

  timer.unref?.();
}

export function getLoadSnapshot() {
  if (!lastSnapshot) lastSnapshot = buildSnapshot();
  return {
    snapshot: lastSnapshot,
    snapshotsTaken,
    snapshotsTriggered,
    lastEvictionAt: lastEvictionAt || null,
    lastFlushAt: lastFlushAt || null,
  };
}
