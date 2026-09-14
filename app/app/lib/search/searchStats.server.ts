import { createHmac } from 'crypto';
import db from '~/lib/Database/supabase';
import { EnvValidator } from '~/lib/EnvValidator';
import { clientIpBucket } from '~/lib/Security/clientIp';
import { textContainsNsfw } from '~/lib/nsfwTextCheck';
import { rateLimiter } from '~/routes/Auth/fun/rateLimit';

const MAX_QUERY = 80;

const URL_LIKE =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|me|app|xyz|ru|tk|link|site|online|info|gg|ly)\b)/i;
const EMAIL_LIKE = /\S+@\S+\.\S+/;
const LONG_DIGITS = /\d{6,}/;

export function normalizeSearchQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_QUERY);
}

// Popular completions are shown to everyone, so anything that could be used to
// push a link, contact details or explicit text never becomes one.
export function isSuggestableQuery(q: string): boolean {
  if (q.length < 2 || q.length > MAX_QUERY) return false;
  if (!/\p{L}/u.test(q)) return false;
  if (URL_LIKE.test(q) || EMAIL_LIKE.test(q) || LONG_DIGITS.test(q)) return false;
  return !textContainsNsfw(q);
}

let searchKey: Buffer | null | undefined;

// Derived from REQUEST_SIG_SECRET under its own purpose tag, so nothing computed
// here can collide with request signatures. Read directly rather than through
// requestSignature.server.ts, which invents a random secret when the env var is
// missing; that would reshuffle every searcher on restart and double count.
function getSearchKey(): Buffer | null {
  if (searchKey !== undefined) return searchKey;
  const master = EnvValidator('REQUEST_SIG_SECRET');
  if (!master || master.length < 32) {
    console.warn('[search] REQUEST_SIG_SECRET missing or short, popular suggestions are not being counted');
    searchKey = null;
    return null;
  }
  searchKey = createHmac('sha256', master).update('memories-search-stats-v1').digest();
  return searchKey;
}

export function logSearchQuery(request: Request, userId: string | null, rawQuery: string): void {
  if (!db) return;
  const q = normalizeSearchQuery(rawQuery);
  if (!isSuggestableQuery(q)) return;

  const key = getSearchKey();
  if (!key) return;
  const identity = userId ? `u:${userId}` : `ip:${clientIpBucket(request)}`;
  if (identity === 'ip:unknown') return;

  // Each new query adds rows, so one person scripting searches must not be able
  // to grow the tables without bound. Over the cap the search still works; it
  // just stops being counted.
  if (!rateLimiter.checkLimit(identity, 'search_log', 30, 60 * 60_000, 60 * 60_000).allowed) return;

  const searcher = createHmac('sha256', key).update(identity).digest('base64url');
  void db.rpc('log_search_query_v2', { p_query: q, p_searcher: searcher }).then(
    ({ error }: { error: { message?: string } | null }) => {
      if (error) console.warn('[search] log:', error.message);
    },
    () => {},
  );
}

export async function getPopularCompletions(rawQuery: string, limit = 8): Promise<string[]> {
  const q = normalizeSearchQuery(rawQuery);
  if (!db || !q) return [];
  const { data, error } = await db.rpc('get_search_completions_v2', { p_query: q, p_limit: limit });
  if (error) {
    console.warn('[search] completions:', error.message);
    return [];
  }
  // Re-checked on read so rows logged before a filter change can't surface.
  return (Array.isArray(data) ? data : [])
    .map((r: { query?: unknown }) => r?.query)
    .filter((t: unknown): t is string => typeof t === 'string' && isSuggestableQuery(t));
}
