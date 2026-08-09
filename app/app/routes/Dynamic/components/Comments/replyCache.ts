import type { Comment } from "~/lib/Services/CommentService";

/**
 * Session cache of loaded reply threads, keyed by `${fileId}:${commentId}`.
 *
 * Reply threads used to live only in CommentItem state, so any remount
 * (closing the drawer, crossing a breakpoint, a root-list refetch) threw them
 * away and the next "View replies" hit the network again. This keeps the last
 * fetched pages around for the session: reopening a thread is instant and
 * request-free, and a background revalidate refreshes stale entries without
 * blocking the UI.
 *
 * Only view data lives here (no secrets); the server still authorizes every
 * fetch, this just avoids repeating ones the client already made.
 */
export interface CachedReplyThread {
  replies: Comment[];
  /** Direct children on the server — drives "Show more replies" pagination. */
  directTotal: number;
  /** Whole-subtree size — drives the "View N replies" label. */
  replyTotal: number;
  fetchedAt: number;
}

const cache = new Map<string, CachedReplyThread>();
const MAX_ENTRIES = 200;
/** Entries older than this are refreshed in the background on next open. */
export const REPLY_CACHE_STALE_MS = 2 * 60 * 1000;

function key(fileId: string, commentId: string): string {
  return `${fileId}:${commentId}`;
}

export function readReplyCache(fileId: string, commentId: string): CachedReplyThread | undefined {
  return cache.get(key(fileId, commentId));
}

export function writeReplyCache(
  fileId: string,
  commentId: string,
  entry: Omit<CachedReplyThread, "fetchedAt"> & { fetchedAt?: number },
): void {
  const k = key(fileId, commentId);
  if (cache.has(k)) cache.delete(k); // bump LRU order
  cache.set(k, { fetchedAt: entry.fetchedAt ?? Date.now(), ...entry });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function dropReplyCache(fileId: string, commentId: string): void {
  cache.delete(key(fileId, commentId));
}

/** Manual reload / delete cascade: forget every thread cached for the file. */
export function dropReplyCacheForFile(fileId: string): void {
  const prefix = `${fileId}:`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}
