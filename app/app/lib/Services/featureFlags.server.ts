/**
 * Feature flag resolution for one viewer.
 *
 * Every page load asks for flags, so the result is cached per viewer for a few
 * seconds. Short on purpose: a kill switch is only useful if flipping it takes
 * effect quickly, and the whole reason this exists is to stop a bad feature
 * without a deploy. Seconds of staleness is the price of not hitting the
 * database on every request.
 */

import db from "~/lib/Database/supabase";

export type FeatureFlags = Readonly<Record<string, boolean>>;

const EMPTY: FeatureFlags = Object.freeze({});

/** Long enough to absorb a page's worth of requests, short enough to kill fast. */
const TTL_MS = 15_000;
const MAX_ENTRIES = 2_000;

type Entry = { flags: FeatureFlags; expires: number };
const cache = new Map<string, Entry>();

function cacheKey(userId: string | null, isStaff: boolean): string {
  return `${userId ?? "anon"}:${isStaff ? 1 : 0}`;
}

function remember(key: string, flags: FeatureFlags) {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.set(key, { flags, expires: Date.now() + TTL_MS });
}

/**
 * Resolved flags for this viewer. Returns an empty set on any failure.
 *
 * Failing to an empty set is deliberate and is the whole safety property: an
 * unreachable database must never switch a half-finished feature on for
 * everyone. Absent means off, so the safe path is always the default.
 */
export async function getFeatureFlags(
  userId: string | null,
  isStaff = false,
): Promise<FeatureFlags> {
  if (!db) return EMPTY;

  const key = cacheKey(userId, isStaff);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.flags;

  try {
    const { data, error } = await db.rpc("get_feature_flags", {
      p_user_id: userId,
      p_is_staff: isStaff,
    });
    if (error) {
      console.warn("[featureFlags]", error.message ?? error);
      return EMPTY;
    }
    const flags: Record<string, boolean> = {};
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (v === true) flags[k] = true;
      }
    }
    const frozen = Object.freeze(flags) as FeatureFlags;
    remember(key, frozen);
    return frozen;
  } catch (e) {
    console.warn("[featureFlags]", e instanceof Error ? e.message : e);
    return EMPTY;
  }
}

/** Drop the cache after a Studio toggle so the change is visible immediately. */
export function invalidateFeatureFlags(): void {
  cache.clear();
}
