import { getVideoSrc } from "~/lib/utils";

type CacheEntry = { url: string; exp: number };

/** In-memory mint cache  keeps the same ?t= URL across watch ↔ mini handoffs. */
const cache = new Map<string, CacheEntry>();

const EXPIRY_BUFFER_MS = 45_000;

function decodeTokenExp(url: string): number | null {
  try {
    const token = new URL(url, "http://local").searchParams.get("t");
    if (!token) return null;
    const payloadB64 = token.split(".")[0];
    if (!payloadB64) return null;
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded)) as { e?: unknown };
    return typeof json.e === "number" && Number.isFinite(json.e) ? json.e : null;
  } catch {
    return null;
  }
}

export function getCachedPlaybackUrl(fileId: string): string | null {
  if (!fileId) return null;
  const entry = cache.get(fileId);
  if (!entry) return null;
  if (Date.now() >= entry.exp - EXPIRY_BUFFER_MS) {
    cache.delete(fileId);
    return null;
  }
  return entry.url;
}

export function setCachedPlaybackUrl(fileId: string, url: string): void {
  if (!fileId || !url) return;
  const exp = decodeTokenExp(url) ?? Date.now() + 5 * 60_000;
  cache.set(fileId, { url, exp });
}

// Refresh subscribers per fileId. When useHLS hits a 401 mid playback it
// calls requestPlaybackUrlRefresh(fileId) which wipes the cache entry and
// pings every usePlaybackUrl mounted for that file to re fetch the mint.
const refreshListeners = new Map<string, Set<() => void>>();

export function clearCachedPlaybackUrl(fileId: string): void {
  if (!fileId) return;
  cache.delete(fileId);
}

export function requestPlaybackUrlRefresh(fileId: string): void {
  if (!fileId) return;
  cache.delete(fileId);
  const subs = refreshListeners.get(fileId);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn();
    } catch {
      /* listener errors are non fatal */
    }
  }
}

export function subscribePlaybackUrlRefresh(
  fileId: string,
  fn: () => void,
): () => void {
  if (!fileId) return () => {};
  let set = refreshListeners.get(fileId);
  if (!set) {
    set = new Set();
    refreshListeners.set(fileId, set);
  }
  set.add(fn);
  return () => {
    const s = refreshListeners.get(fileId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) refreshListeners.delete(fileId);
  };
}

/** Same manifest path (ignores rotating ?t= tokens). */
export function playbackAssetPath(url: string): string | null {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://local");
    return u.pathname;
  } catch {
    return null;
  }
}

/** True when a LoadPlay (or /v/{id}/) URL belongs to the given file. */
export function playbackUrlMatchesFile(url: string, fileId: string): boolean {
  if (!url?.trim() || !fileId) return false;
  const path = playbackAssetPath(url);
  if (!path) return false;
  return path.includes(`/v/${fileId}/`);
}

/**
 * Pick a stable playback src for the global player. Prefers the live
 * player URL, then cache, then a freshly minted URL.
 */
export function resolvePlaybackSrc(
  file: {
    unique_id?: string | null;
    endpoint?: string | null;
    file_type?: string | null;
  },
  opts?: { preferredSrc?: string | null; mintedUrl?: string | null },
): string {
  const fileId = file.unique_id ?? "";
  let preferred = opts?.preferredSrc?.trim() ?? "";
  if (preferred && fileId && !playbackUrlMatchesFile(preferred, fileId)) {
    preferred = "";
  }
  if (preferred) {
    if (fileId) setCachedPlaybackUrl(fileId, preferred);
    return preferred;
  }
  const cached = fileId ? getCachedPlaybackUrl(fileId) : null;
  if (cached) return cached;
  let mintedUrl = opts?.mintedUrl ?? null;
  if (mintedUrl && fileId && !playbackUrlMatchesFile(mintedUrl, fileId)) {
    mintedUrl = null;
  }
  const minted = getVideoSrc(file.endpoint ?? "", file.file_type ?? undefined, mintedUrl);
  if (minted && fileId) setCachedPlaybackUrl(fileId, minted);
  return minted;
}
