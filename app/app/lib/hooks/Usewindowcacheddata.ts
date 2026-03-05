import { useEffect } from "react";
import { usePageCache } from "../Context/PageCacheContext";

/**
 * Hook that caches loader data in page cache context and returns cached data
 * if the loader data hasn't arrived yet (e.g. during navigation).
 *
 * Usage:
 *   const loaderData = useLoaderData<typeof loader>();
 *   const data = useWindowCachedData(cacheKey, loaderData);
 *
 * `data` will be the cached version instantly on mount, then swap
 * to fresh loaderData once it's available. If loaderData is already
 * present (SSR or fast load), it uses that directly and updates the cache.
 */
export function useWindowCachedData<T>(
  cacheKey: string,
  loaderData: T,
  ttl?: number
): T {
  const { getCache, setCache } = usePageCache();

  // Whenever we get fresh loader data, save it to the cache
  useEffect(() => {
    if (loaderData != null) {
      setCache(cacheKey, loaderData, ttl);
    }
  }, [cacheKey, loaderData, ttl, setCache]);

  // If loader data is present, always prefer it (it's fresh)
  if (loaderData != null) {
    return loaderData;
  }

  // Otherwise, try to return cached data from context (same store as clientLoader)
  const cached = getCache<T>(cacheKey);
  return cached ?? loaderData;
}