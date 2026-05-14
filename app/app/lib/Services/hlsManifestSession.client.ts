/**
 * Client: exchange root bootstrap for a one-shot `_mk` manifest key.
 *
 * The server already returns the *same* `_mk` for repeated POSTs of the same
 * (sessionScope, manifestPath, kind) tuple until that key is consumed at the CDN
 * (see `hlsManifestGate.server`). To stop the network round trip on every player
 * re-mount we hold a small in-memory cache here keyed by `manifestPath` — bounded
 * lifetime, deduped by a single in-flight `Promise`, explicitly invalidated by
 * `invalidateManifestKeyCache(src)` when a downstream manifest fetch 4xxs.
 *
 * Security notes:
 *  - Cache lives in JS heap only (no localStorage / cookies / disk). Per-tab,
 *    cleared on navigation, never crosses session scopes.
 *  - TTL is capped at MAX_REUSE_MS regardless of what the server reports, so
 *    a token that has been consumed at the CDN gets discarded quickly.
 *  - Token is stored bare; we rebuild the URL from the *current* `src` each
 *    call so per-mount query-string variation never desyncs the cached entry.
 *  - LRU cap so we don't grow without bound on long browsing sessions.
 */

export function manifestPathFromVideoApiUrl(src: string): string | null {
  const i = src.indexOf("/api/load/video/");
  if (i === -1) return null;
  const rest = src.slice(i + "/api/load/video/".length);
  const path = rest.split("?")[0]?.split("#")[0];
  return path || null;
}

export function stripMkSearchParam(href: string): string {
  try {
    const u = new URL(href, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    u.searchParams.delete("_mk");
    const q = u.searchParams.toString();
    return `${u.pathname}${q ? `?${q}` : ""}${u.hash}`;
  } catch {
    return href
      .replace(/([?&])_mk=[^&]*&?/g, "$1")
      .replace(/[?&]$/, "");
  }
}

interface CacheEntry {
  mk: string;
  expiresAt: number;
}

/** Cap the cache so a long browsing session can't leak entries indefinitely. */
const MAX_CACHE_SIZE = 50;
/**
 * Hard ceiling on how long we'll reuse a cached token, regardless of the server's
 * reported expiry. Tokens are single-use at the CDN gate — keeping the window short
 * minimises the chance of replaying a token whose master manifest has already been
 * consumed (which would 403 at the gate). 60s is enough to cover rapid re-mounts
 * (layout switches, mini ↔ main, StrictMode) without straying into "stale post-play".
 */
const MAX_REUSE_MS = 60_000;
/** Don't return a cached token whose remaining life is below this — refetch instead. */
const SAFETY_MARGIN_MS = 2_000;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

function touchCache(manifestPath: string, entry: CacheEntry): void {
  // Map preserves insertion order; delete + set moves entry to "most recent" for LRU eviction.
  cache.delete(manifestPath);
  cache.set(manifestPath, entry);
  if (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (typeof firstKey === "string") cache.delete(firstKey);
  }
}

function buildUrlWithMk(src: string, mk: string): string {
  const u = new URL(
    src,
    typeof window !== "undefined" ? window.location.origin : "http://localhost",
  );
  u.searchParams.set("_mk", mk);
  return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * Drop the cached `_mk` for the video this `src` points at. Callers should run this
 * whenever a manifest fetch responds with 401/403 — the cached token was almost
 * certainly consumed at the CDN by an earlier load, and the next call needs to mint
 * a fresh one.
 */
export function invalidateManifestKeyCache(src: string): void {
  const path = manifestPathFromVideoApiUrl(src);
  if (path) cache.delete(path);
}

export async function exchangeHlsManifestKey(
  src: string,
  bootstrap: string | null | undefined,
  bootstrapRetry: string | null | undefined,
): Promise<string | null> {
  const manifestPath = manifestPathFromVideoApiUrl(src);
  if (!manifestPath || !bootstrap) return null;

  const now = Date.now();
  const cached = cache.get(manifestPath);
  if (cached && cached.expiresAt > now + SAFETY_MARGIN_MS) {
    // Same `(session, manifestPath)` would return the same id on the server anyway;
    // skip the round trip and rebuild the URL with the cached token + current src.
    touchCache(manifestPath, cached);
    return buildUrlWithMk(src, cached.mk);
  }

  const existing = inflight.get(manifestPath);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    const post = async (b: string): Promise<string | null> => {
      let res: Response;
      try {
        res = await fetch("/api/load/hls-manifest-session", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bootstrap: b, manifestPath }),
        });
      } catch {
        return null;
      }
      if (!res.ok) return null;
      let data: { manifestKey?: string; expiresInSeconds?: number };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        return null;
      }
      const mk = data?.manifestKey;
      if (typeof mk !== "string" || !mk) return null;
      const serverTtlMs =
        typeof data.expiresInSeconds === "number" && data.expiresInSeconds > 0
          ? data.expiresInSeconds * 1000
          : MAX_REUSE_MS;
      const ttlMs = Math.min(MAX_REUSE_MS, serverTtlMs);
      touchCache(manifestPath, { mk, expiresAt: Date.now() + ttlMs });
      return buildUrlWithMk(src, mk);
    };

    let out = await post(bootstrap);
    if (out) return out;
    if (bootstrapRetry) out = await post(bootstrapRetry);
    return out;
  })();

  inflight.set(manifestPath, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(manifestPath);
  }
}
