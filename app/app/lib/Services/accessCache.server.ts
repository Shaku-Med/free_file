/**
 * Per-process access-control cache. Used by the load/image, load/video and
 * load/hls-manifest-session endpoints  every video segment and every thumbnail
 * goes through one of those, so hitting Supabase for the same file row / same
 * user context dozens of times per minute is wasted work.
 *
 * Two narrow caches with short TTLs:
 *  1. File row by `unique_id`  only the visibility fields needed for the access
 *     check. Owners flipping a file to private propagates within FILE_TTL_MS at
 *     worst, OR immediately when the file edit endpoint calls
 *     `invalidateFileByUniqueId`.
 *  2. User access context by encrypted `c_user` cookie  `id, dob, verified,
 *     show_nsfw`. Settings changes propagate within USER_TTL_MS, OR immediately
 *     when the settings endpoint calls `invalidateUserAccessContextById`.
 *
 * Security notes:
 *  - In-memory only. Per-process, per-tab JS isolation in the runtime.
 *  - Memory bounded by hard LRU caps; cannot grow unbounded under load.
 *  - Cache the *positive* lookup only; nulls go through every time so a
 *    misbehaving caller probing for unique_ids can't get cheap "not found"
 *    answers from cache (they hit the DB rate limit naturally).
 *  - Cookies are keys but never serialized anywhere off-process.
 *  - Cache falls back to DB on any read miss  failure-open is fine here
 *    because the cache only ever returns rows the DB already returned.
 */

import db from "~/lib/Database/supabase";
import { getCookie } from "~/lib/Security/Token";
import { DecryptCombine } from "~/lib/Security/unsharedkeyEncryption/Combined/Combined";
import { getAllKeys } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys";

export interface CachedFileAccess {
  id: string;
  unique_id: string;
  is_adult: boolean;
  is_public: boolean;
  owner_id: string;
  upload_status: string | null;
  github_repo: string | null;
  storage_backend: string | null;
  storage_bucket: string | null;
  duration: number | null;
}

export interface CachedUserAccess {
  id: string;
  dob: string;
  verified: boolean;
  showNsfw: boolean;
}

/**
 * File visibility doesn't change often, but when it does (owner flips public→private,
 * NSFW reclassify) we want it propagated quickly. 30s + explicit invalidate.
 */
const FILE_TTL_MS = 30_000;
/**
 * User context (NSFW toggle, verification) changes even less often. 60s + explicit
 * invalidate on settings updates.
 */
const USER_TTL_MS = 60_000;
const MAX_FILE_ENTRIES = 500;
const MAX_USER_ENTRIES = 200;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const fileByUniqueId = new Map<string, Entry<CachedFileAccess>>();
const userByCookie = new Map<string, Entry<CachedUserAccess>>();

function readFresh<T>(map: Map<string, Entry<T>>, key: string): T | null {
  const e = map.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  // Touch for LRU ordering  Map iteration order is insertion order, so
  // delete+set moves the entry to "most recent".
  map.delete(key);
  map.set(key, e);
  return e.value;
}

function writeWithLru<T>(
  map: Map<string, Entry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  cap: number,
): void {
  map.delete(key);
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (map.size > cap) {
    const firstKey = map.keys().next().value;
    if (typeof firstKey !== "string") break;
    map.delete(firstKey);
  }
}

/**
 * Returns the cached file row for access decisions, or queries Supabase + caches.
 * Returns null if the file doesn't exist (not cached) or DB is unavailable.
 */
export async function getCachedFileByUniqueId(
  uniqueId: string,
): Promise<CachedFileAccess | null> {
  if (!uniqueId) return null;
  const cached = readFresh(fileByUniqueId, uniqueId);
  if (cached) return cached;
  if (!db) return null;

  try {
    const { data } = await db
      .from("files")
      .select("id, unique_id, is_adult, is_public, visibility, owner_id, upload_status, github_repo, storage_backend, storage_bucket, duration")
      .eq("unique_id", uniqueId)
      .maybeSingle();
    if (!data) return null;
    const row: CachedFileAccess = {
      id: String(data.id ?? ""),
      unique_id: String(data.unique_id ?? uniqueId),
      is_adult: Boolean(data.is_adult),
      is_public: data.is_public !== false,
      owner_id: String(data.owner_id ?? ""),
      upload_status: typeof data.upload_status === "string" ? data.upload_status : null,
      github_repo: typeof data.github_repo === "string" ? data.github_repo : null,
      storage_backend: typeof data.storage_backend === "string" ? data.storage_backend : null,
      storage_bucket: typeof data.storage_bucket === "string" ? data.storage_bucket : null,
      duration: typeof data.duration === "number" ? data.duration : null,
    };
    writeWithLru(fileByUniqueId, uniqueId, row, FILE_TTL_MS, MAX_FILE_ENTRIES);
    return row;
  } catch {
    return null;
  }
}

/** Drop the cached row for one file  call this on PATCH /api/files. */
export function invalidateFileByUniqueId(uniqueId: string | null | undefined): void {
  if (uniqueId) fileByUniqueId.delete(uniqueId);
}

/** Drop everything  useful in tests / on environment switches. */
export function clearAccessCaches(): void {
  fileByUniqueId.clear();
  userByCookie.clear();
}

/**
 * Returns the cached user-access context (auth + NSFW preference) for the request's
 * `c_user` cookie, or queries Supabase + caches. Null when the cookie is missing,
 * malformed, or the user row no longer exists.
 *
 * The cache key is the cookie string itself  same cookie → same user, and the
 * cookie rotates on logout / password reset which auto-invalidates the entry.
 */
export async function getCachedUserAccessContext(
  request: Request,
): Promise<CachedUserAccess | null> {
  const cookie = getCookie("c_user", request.headers);
  if (!cookie || !db) return null;

  const cached = readFresh(userByCookie, cookie);
  if (cached) return cached;

  try {
    const keys = await getAllKeys(["token1", "c_user"]);
    if (!keys) return null;
    const decoded = await DecryptCombine(cookie, keys);
    if (!decoded || typeof decoded !== "object" || !decoded.c_usr) return null;

    const { data } = await db
      .from("users")
      .select("id, dob, verified, show_nsfw")
      .eq("c_usr", decoded.c_usr)
      .maybeSingle();
    if (!data?.id) return null;

    const value: CachedUserAccess = {
      id: String(data.id),
      dob: typeof data.dob === "string" ? data.dob : "",
      verified: Boolean(data.verified),
      showNsfw: Boolean(data.show_nsfw),
    };
    writeWithLru(userByCookie, cookie, value, USER_TTL_MS, MAX_USER_ENTRIES);
    return value;
  } catch {
    return null;
  }
}

/** Drop every cached entry belonging to one user  call on settings update / logout. */
export function invalidateUserAccessContextById(userId: string | null | undefined): void {
  if (!userId) return;
  for (const [key, entry] of userByCookie) {
    if (entry.value.id === userId) userByCookie.delete(key);
  }
}
