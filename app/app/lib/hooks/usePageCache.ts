import { useCallback } from "react";
import type { PageCacheData, PageCacheEntry } from "~/lib/types";
import { useFileContext } from "~/lib/Context/Context";

type PageCacheItem = Record<string, PageCacheData>;

/**
 * Hook to read and mutate the page cache (array of { [pathname]: PageCacheData }).
 * Use within a ContextProvider.
 */
export function usePageCache() {
  const { pageCache, setPageCache } = useFileContext();

  const getFromCache = useCallback(
    (pathname: string): PageCacheData | undefined => {
      const entry = pageCache.find((item: PageCacheItem) => pathname in item);
      return entry ? entry[pathname] : undefined;
    },
    [pageCache]
  );

  const addToCache = useCallback(
    (pathname: string, data: PageCacheData) => {
      setPageCache((prev: PageCacheEntry) => {
        const without = prev.filter((item: PageCacheItem) => !(pathname in item));
        return [...without, { [pathname]: data }];
      });
    },
    [setPageCache]
  );

  const removeFromCache = useCallback(
    (pathname: string) => {
      setPageCache((prev: PageCacheEntry) => prev.filter((item: PageCacheItem) => !(pathname in item)));
    },
    [setPageCache]
  );

  return {
    pageCache,
    getFromCache,
    addToCache,
    removeFromCache,
  };
}
