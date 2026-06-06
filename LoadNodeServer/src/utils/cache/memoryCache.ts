// In-process LRU for upstream GitHub/R2 responses. Public, non-adult,
// non-blurred only — anything user-specific stays per-request.

export interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  cacheControl: string;
  expiresAt: number;
  insertedAt: number;
  size: number;
}

interface CacheConfig {
  maxBytes: number;
  defaultTtlMs: number;
}

class MemoryLRU {
  private readonly store = new Map<string, CacheEntry>();
  private readonly cfg: CacheConfig;
  private cumulativeBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(cfg: CacheConfig) {
    this.cfg = cfg;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.cumulativeBytes -= entry.size;
      this.misses++;
      return undefined;
    }
    // Re-insert to move to tail (most-recently-used).
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry;
  }

  set(
    key: string,
    buffer: Buffer,
    contentType: string,
    cacheControl: string,
    ttlMs?: number,
  ): void {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return;
    if (buffer.length > this.cfg.maxBytes) return;

    const existing = this.store.get(key);
    if (existing) {
      this.cumulativeBytes -= existing.size;
      this.store.delete(key);
    }

    const ttl = ttlMs && ttlMs > 0 ? ttlMs : this.cfg.defaultTtlMs;
    const now = Date.now();
    const size = buffer.length + 256;

    this.store.set(key, {
      buffer, contentType, cacheControl,
      expiresAt: now + ttl, insertedAt: now, size,
    });
    this.cumulativeBytes += size;

    while (this.cumulativeBytes > this.cfg.maxBytes && this.store.size > 0) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const victim = this.store.get(oldestKey);
      this.store.delete(oldestKey);
      if (victim) this.cumulativeBytes -= victim.size;
      this.evictions++;
    }
  }

  // Called by the load monitor under memory/CPU pressure.
  evictFraction(fraction: number): number {
    const f = Math.max(0, Math.min(1, fraction));
    if (f === 0 || this.store.size === 0) return 0;
    const target = this.cumulativeBytes * (1 - f);
    let droppedCount = 0;
    while (this.cumulativeBytes > target && this.store.size > 0) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const victim = this.store.get(oldestKey);
      this.store.delete(oldestKey);
      if (victim) this.cumulativeBytes -= victim.size;
      droppedCount++;
      this.evictions++;
    }
    return droppedCount;
  }

  clear(): void {
    this.evictions += this.store.size;
    this.store.clear();
    this.cumulativeBytes = 0;
  }

  stats() {
    return {
      entries: this.store.size,
      bytes: this.cumulativeBytes,
      maxBytes: this.cfg.maxBytes,
      utilization: this.cfg.maxBytes > 0 ? this.cumulativeBytes / this.cfg.maxBytes : 0,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
    };
  }
}

let singleton: MemoryLRU | null = null;

// Env knobs: LOAD_CACHE_MAX_BYTES (256 MiB), LOAD_CACHE_TTL_MS (24 h).
// Set LOAD_CACHE_MAX_BYTES=0 to disable.
export function getMemoryCache(): MemoryLRU {
  if (singleton) return singleton;
  singleton = new MemoryLRU({
    maxBytes: parseIntEnv('LOAD_CACHE_MAX_BYTES', 256 * 1024 * 1024),
    defaultTtlMs: parseIntEnv('LOAD_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
  });
  return singleton;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// NUL separator stops attacker-controlled paths from colliding with legit keys.
export function buildCacheKey(args: {
  path: string;
  quality: string | null | undefined;
  blur: boolean;
  backend: 'gh' | 'r2';
}): string {
  const q = (args.quality ?? '').trim();
  return `${args.backend}\0${args.path}\0${q}\0${args.blur ? '1' : '0'}`;
}
