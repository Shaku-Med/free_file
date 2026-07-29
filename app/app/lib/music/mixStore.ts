import type { FileType } from "~/lib/types";

/**
 * Single client-side source of truth for a loaded mix.
 *
 * Three consumers need the same list and must not each fetch it:
 *   - MixPanel (the sidebar queue)
 *   - the player / queue context (what plays next)
 *   - the watch loader (server-preloaded first page, primed via `primeMix`)
 *
 * Module-level on purpose: the sidebar unmounts and remounts on breakpoint
 * changes, so any in-component state would refetch on every resize.
 */

export interface MixState {
  items: FileType[];
  total: number;
  hasMore: boolean;
}

const cache = new Map<string, MixState>();
const inflight = new Map<string, Promise<MixState | null>>();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a bad subscriber must not break the others */
    }
  }
}

export function subscribeMix(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getMix(gid: string): MixState | undefined {
  return gid ? cache.get(gid) : undefined;
}

/**
 * Seed the cache from server-rendered loader data so the first paint has the
 * queue already — no spinner, no client round trip.
 */
export function primeMix(gid: string, state: MixState): void {
  if (!gid || cache.has(gid)) return;
  cache.set(gid, state);
  emit();
}

export async function loadMix(
  gid: string,
  offset = 0,
  limit = 20,
): Promise<MixState | null> {
  if (!gid) return null;

  // Page 0 with something cached is a no-op; the caller already has it.
  if (offset === 0) {
    const hit = cache.get(gid);
    if (hit) return hit;
    const pending = inflight.get(gid);
    if (pending) return pending;
  }

  const run = (async (): Promise<MixState | null> => {
    try {
      const res = await fetch(
        `/api/music/mix?list=${encodeURIComponent(gid)}&limit=${limit}&offset=${offset}`,
        { credentials: "include" },
      );
      if (!res.ok) return null;
      const body = await res.json();
      const next: FileType[] = Array.isArray(body?.items) ? body.items : [];
      const prev = offset > 0 ? (cache.get(gid)?.items ?? []) : [];
      const state: MixState = {
        items: offset > 0 ? [...prev, ...next] : next,
        total: Number(body?.total) || 0,
        hasMore: Boolean(body?.hasMore),
      };
      cache.set(gid, state);
      emit();
      return state;
    } catch {
      return null;
    } finally {
      if (offset === 0) inflight.delete(gid);
    }
  })();

  if (offset === 0) inflight.set(gid, run);
  return run;
}

/**
 * The track after `currentUniqueId` in the mix.
 * This is what makes auto-advance follow the MIX rather than generic related
 * videos. Returns null at the end of the loaded window so the caller can decide
 * whether to page in more or stop.
 */
export function nextInMix(
  gid: string,
  currentUniqueId: string,
): { item: FileType; index: number } | null {
  const state = cache.get(gid);
  if (!state || state.items.length === 0) return null;
  const i = state.items.findIndex(
    (f) => String(f.unique_id) === String(currentUniqueId),
  );
  // Unknown current track (e.g. opened mid-list): start from the top.
  if (i === -1) return { item: state.items[0], index: 1 };
  const next = state.items[i + 1];
  return next ? { item: next, index: i + 2 } : null;
}

/** Unique display names of the artists in a mix, in first-appearance order. */
export function mixArtists(
  gid: string,
  limit = 3,
): Array<{ id: string; username: string }> {
  const state = cache.get(gid);
  if (!state) return [];
  const seen = new Set<string>();
  const out: Array<{ id: string; username: string }> = [];
  for (const item of state.items) {
    const owner = (item as { owner?: { id?: string; username?: string } }).owner;
    const username = owner?.username;
    if (!username || seen.has(username)) continue;
    seen.add(username);
    out.push({ id: String(owner?.id ?? ""), username });
    if (out.length >= limit) break;
  }
  return out;
}
