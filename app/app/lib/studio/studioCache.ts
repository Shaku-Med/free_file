import { useEffect, useState } from "react";

// Module level cache. Persists across studio tab switches so we never
// refetch on tab swap. Cleared by hard navigation (page reload).

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

function get<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

function set<T>(key: string, value: T, ttlMs: number) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateStudioCache(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

interface FetchOpts {
  cacheKey: string;
  ttlMs?: number;
  url: string;
  init?: RequestInit;
}

interface State<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

// Cached studio data fetcher. Returns cached value instantly when
// available, otherwise fetches and caches. Tab switches do not retrigger
// the network call as long as the entry is still fresh.
export function useStudioData<T>(opts: FetchOpts | null): State<T> & { refresh: () => void } {
  const cached = opts ? get<T>(opts.cacheKey) : undefined;
  const [state, setState] = useState<State<T>>(() => ({
    data: cached ?? null,
    loading: !cached && Boolean(opts),
    error: false,
  }));
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!opts) {
      setState({ data: null, loading: false, error: false });
      return;
    }

    const hit = get<T>(opts.cacheKey);
    if (hit && refreshTick === 0) {
      setState({ data: hit, loading: false, error: false });
      return;
    }

    let cancelled = false;
    setState((s) => ({ data: s.data, loading: true, error: false }));
    fetch(opts.url, { credentials: "same-origin", ...opts.init })
      .then(async (r) => (r.ok ? (await r.json()) : null))
      .then((json) => {
        if (cancelled) return;
        if (!json) {
          setState({ data: null, loading: false, error: true });
          return;
        }
        set(opts.cacheKey, json as T, opts.ttlMs ?? 5 * 60_000);
        setState({ data: json as T, loading: false, error: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [opts?.cacheKey, opts?.url, refreshTick]);

  return {
    ...state,
    refresh: () => {
      if (opts) invalidateStudioCache(opts.cacheKey);
      setRefreshTick((t) => t + 1);
    },
  };
}
