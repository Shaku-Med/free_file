// Cache TTL in milliseconds (5 minutes default)
const DEFAULT_TTL = 5 * 60 * 1000;

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Save arbitrary data to the window cache for a given pathname.
 */
export const saveToWindowCache = <T>(pathname: string, data: T, ttl: number = DEFAULT_TTL): boolean => {
  if (typeof window === "undefined") return false;
  const wind = window as any;
  if (!wind.__dynamicPageCache) wind.__dynamicPageCache = {};
  wind.__dynamicPageCache[pathname] = {
    data,
    timestamp: Date.now(),
    ttl,
  } satisfies CacheEntry<T>;
  return true;
};

/**
 * Retrieve cached data for a given pathname.
 * Returns null if not found or expired.
 */
export const getFromWindowCache = <T>(pathname: string): T | null => {
  if (typeof window === "undefined") return null;
  const wind = window as any;
  const entry = wind.__dynamicPageCache?.[pathname] as CacheEntry<T> | undefined;
  if (!entry) return null;
  // Check TTL expiry
  if (Date.now() - entry.timestamp > entry.ttl) {
    delete wind.__dynamicPageCache[pathname];
    return null;
  }
  return entry.data;
};

/**
 * Invalidate a specific cache entry.
 */
export const invalidateWindowCache = (pathname: string): void => {
  if (typeof window === "undefined") return;
  const wind = window as any;
  if (wind.__dynamicPageCache?.[pathname]) {
    delete wind.__dynamicPageCache[pathname];
  }
};

/**
 * Invalidate all cache entries matching a prefix.
 * e.g. invalidateByPrefix("/profile/") clears all profile caches.
 */
export const invalidateByPrefix = (prefix: string): void => {
  if (typeof window === "undefined") return;
  const wind = window as any;
  if (!wind.__dynamicPageCache) return;
  for (const key of Object.keys(wind.__dynamicPageCache)) {
    if (key.startsWith(prefix)) {
      delete wind.__dynamicPageCache[key];
    }
  }
};

/**
 * Clear the entire cache.
 */
export const clearWindowCache = (): void => {
  if (typeof window === "undefined") return;
  (window as any).__dynamicPageCache = {};
};