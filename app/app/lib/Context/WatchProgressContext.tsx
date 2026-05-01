import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface WatchProgressEntry {
  currentTime: number;
  duration: number;
  updatedAt: number;
}

interface WatchProgressContextValue {
  /** Latest known progress map; keys are file UUIDs. Cards read from this. */
  progress: Map<string, WatchProgressEntry>;
  /** Cards call this with their file uuid; the context batches into one /api/watch-progress request. */
  request: (fileId: string) => void;
  /** Manual upsert from the player so unmount writes are visible immediately on the next grid hop. */
  setLocal: (fileId: string, entry: WatchProgressEntry) => void;
}

const WatchProgressContext = createContext<WatchProgressContextValue | null>(null);

const BATCH_FLUSH_MS = 50;
/** Cap a single flush; the bulk endpoint clamps at 200 anyway. */
const MAX_PER_BATCH = 200;
/** Skip re-fetching a file we already pulled within this window. */
const REFETCH_INTERVAL_MS = 60_000;

export function WatchProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<Map<string, WatchProgressEntry>>(() => new Map());
  const lastFetchedRef = useRef<Map<string, number>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const ids = Array.from(pendingRef.current).slice(0, MAX_PER_BATCH);
    pendingRef.current = new Set(Array.from(pendingRef.current).slice(MAX_PER_BATCH));
    if (ids.length === 0) return;

    const now = Date.now();
    for (const id of ids) lastFetchedRef.current.set(id, now);

    void (async () => {
      try {
        const res = await fetch(
          `/api/watch-progress?fileIds=${encodeURIComponent(ids.join(','))}`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          progress?: Record<
            string,
            { currentTime: number; duration: number; updatedAt: string }
          >;
        };
        const incoming = json?.progress ?? {};
        setProgress((prev) => {
          const next = new Map(prev);
          for (const id of ids) {
            const row = incoming[id];
            if (!row) continue;
            const updatedAtMs = Date.parse(row.updatedAt);
            next.set(id, {
              currentTime: Number(row.currentTime) || 0,
              duration: Number(row.duration) || 0,
              updatedAt: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
            });
          }
          return next;
        });
      } catch {
        /* best-effort — cards just won't show a progress bar */
      } finally {
        if (pendingRef.current.size > 0 && flushTimerRef.current == null) {
          flushTimerRef.current = setTimeout(flush, BATCH_FLUSH_MS);
        }
      }
    })();
  }, []);

  const request = useCallback(
    (fileId: string) => {
      if (!fileId) return;
      const last = lastFetchedRef.current.get(fileId) ?? 0;
      if (Date.now() - last < REFETCH_INTERVAL_MS) return;
      pendingRef.current.add(fileId);
      if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(flush, BATCH_FLUSH_MS);
      }
    },
    [flush],
  );

  const setLocal = useCallback((fileId: string, entry: WatchProgressEntry) => {
    if (!fileId) return;
    lastFetchedRef.current.set(fileId, Date.now());
    setProgress((prev) => {
      const next = new Map(prev);
      next.set(fileId, entry);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  const value = useMemo(
    () => ({ progress, request, setLocal }),
    [progress, request, setLocal],
  );

  return (
    <WatchProgressContext.Provider value={value}>{children}</WatchProgressContext.Provider>
  );
}

/**
 * Read this file's stored progress and ask the provider to fetch it if we haven't yet.
 * Cards call this with their file uuid; returns null until the batched fetch resolves
 * (or forever, for files the user has never watched).
 */
export function useWatchProgress(fileId: string | null | undefined): WatchProgressEntry | null {
  const ctx = useContext(WatchProgressContext);
  useEffect(() => {
    if (!ctx || !fileId) return;
    ctx.request(fileId);
  }, [ctx, fileId]);
  if (!ctx || !fileId) return null;
  return ctx.progress.get(fileId) ?? null;
}

/**
 * For the player's `usePlaybackPosition` to seed the cache without an extra round-trip
 * after it just upserted to the server. Safe to call when not inside the provider.
 */
export function useWatchProgressWriter() {
  const ctx = useContext(WatchProgressContext);
  return ctx?.setLocal;
}
