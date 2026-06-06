// Short-TTL caches for the Supabase lookups that ran on every image request.
// Tiny payloads (file rows / backend tags), so a huge entry count fits in <1 MB.

interface Slot<T> {
  value: T;
  expiresAt: number;
}

class TTLMap<T> {
  private readonly store = new Map<string, Slot<T>>();
  constructor(private readonly maxEntries: number, private readonly defaultTtlMs: number) {}

  get(key: string): T | undefined {
    const slot = this.store.get(key);
    if (!slot) return undefined;
    if (slot.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Move to tail for LRU.
    this.store.delete(key);
    this.store.set(key, slot);
    return slot.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (!oldest) break;
      this.store.delete(oldest);
    }
  }

  size(): number {
    return this.store.size;
  }
}

// Stable for ~1 min — long enough to absorb bursts, short enough that a
// public→private toggle by the owner stops being served within a minute.
const FILE_META_TTL_MS  = 60_000;
const FILE_404_TTL_MS   = 30_000;
const COMMENT_META_TTL_MS = 5 * 60_000;

// File metadata by storage path. `null` is cached (negative cache) so a
// flood of bogus paths doesn't keep hitting Supabase.
export const fileMetaCache = new TTLMap<unknown | null>(5_000, FILE_META_TTL_MS);
// Comment-image backend + repo lookups.
export const commentBackendCache = new TTLMap<'github' | 'r2'>(5_000, COMMENT_META_TTL_MS);
export const commentRepoCache = new TTLMap<string | null>(5_000, COMMENT_META_TTL_MS);

export { FILE_404_TTL_MS };
