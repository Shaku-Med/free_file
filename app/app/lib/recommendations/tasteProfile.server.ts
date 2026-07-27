import db from '~/lib/Database/supabase';

/**
 * Per-viewer taste profile — the "it knows me" layer.
 *
 * HOW THE BIG PLATFORMS ACTUALLY DO IT (and what we copy):
 * Explicit signals (likes) are rare and noisy. The real workhorse is IMPLICIT
 * behaviour, above all COMPLETION: did you finish it, or bail after 5 seconds?
 * YouTube optimises watch time, Instagram optimises completion + dwell. We have
 * `user_watch_progress(current_time_s, duration_s)`, which is exactly that
 * signal, so it carries the most weight here after explicit likes/dislikes.
 *
 * We reduce raw events into two small affinity maps — CREATORS and CATEGORIES —
 * because those generalise to unseen items. A per-item score can only rank
 * things you already touched; an affinity for a creator or a tag lets us rank
 * something you've never seen, which is the whole point of a recommendation.
 *
 * Every signal is RECENCY-DECAYED (21-day half-life). Taste drifts; what you
 * binged in March shouldn't outrank last week forever.
 *
 * Deliberately NOT a black box: the returned profile is inspectable, so a mix
 * can explain itself and we can debug why something surfaced.
 */

/** Signals older than this contribute ~nothing; keeps the queries bounded. */
const LOOKBACK_DAYS = 120;
const HALF_LIFE_DAYS = 21;
/** Per-signal row caps so a power user can't turn this into a huge scan. */
const ROW_CAP = 400;

const W = {
  like: 3,
  dislike: -4,
  finished: 2.5, // >= 80% watched
  engaged: 1, // 30-80%
  abandoned: -1.2, // started and bailed — the "not for me" signal
  subscription: 2.5,
} as const;

export interface TasteProfile {
  userId: string | null;
  creators: Map<string, number>;
  categories: Map<string, number>;
  /** file_id -> completion ratio 0..1, for "already satisfied" checks. */
  completion: Map<string, number>;
  /** Files with an explicit negative signal — should never be recommended. */
  suppressed: Set<string>;
  /** True when we had enough signal to personalise at all. */
  hasSignal: boolean;
}

export const EMPTY_PROFILE: TasteProfile = {
  userId: null,
  creators: new Map(),
  categories: new Map(),
  completion: new Map(),
  suppressed: new Set(),
  hasSignal: false,
};

/** Exponential recency decay. 1.0 today, 0.5 at one half-life. */
function decay(iso: unknown): number {
  const t = iso ? Date.parse(String(iso)) : NaN;
  if (!Number.isFinite(t)) return 0.35; // unknown date: dampened, not dropped
  const ageDays = (Date.now() - t) / 86_400_000;
  if (ageDays < 0) return 1;
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function parseCats(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return [];
          }
        })()
      : [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c.length > 0 && c.length <= 64)
    .slice(0, 12);
}

function add(map: Map<string, number>, key: string, amount: number) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * Normalise a map to 0..1 by its max, so creator and category affinities are
 * comparable to each other (and to similarity scores) regardless of how much
 * history a given viewer has.
 */
function normalize(map: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of map.values()) max = Math.max(max, Math.abs(v));
  if (max <= 0) return map;
  const out = new Map<string, number>();
  for (const [k, v] of map) out.set(k, v / max);
  return out;
}

export async function buildTasteProfile(userId: string | null): Promise<TasteProfile> {
  if (!db || !userId) return { ...EMPTY_PROFILE };

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  // One round trip per signal, in parallel. Each joins `files` so we get the
  // creator + tags of the item the signal is about.
  const fileJoin = 'files!inner(id, owner_id, categories, is_music)';
  const [likesRes, dislikesRes, progressRes, subsRes] = await Promise.all([
    db
      .from('likes')
      .select(`file_id, created_at, ${fileJoin}`)
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ROW_CAP),
    db
      .from('dislike')
      .select(`file_id, created_at, ${fileJoin}`)
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ROW_CAP),
    db
      .from('user_watch_progress')
      .select(`file_id, current_time_s, duration_s, updated_at, ${fileJoin}`)
      .eq('user_id', userId)
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(ROW_CAP),
    db.from('subscriptions').select('channel_id').eq('subscriber_id', userId).limit(200),
  ]);

  const creators = new Map<string, number>();
  const categories = new Map<string, number>();
  const completion = new Map<string, number>();
  const suppressed = new Set<string>();
  let signals = 0;

  const applyRow = (row: any, weight: number, dateField: string) => {
    const f = row?.files;
    if (!f) return;
    const w = weight * decay(row[dateField]);
    add(creators, String(f.owner_id ?? ''), w);
    for (const c of parseCats(f.categories)) add(categories, c, w);
    signals++;
  };

  for (const row of (likesRes?.data ?? []) as any[]) {
    applyRow(row, W.like, 'created_at');
  }

  for (const row of (dislikesRes?.data ?? []) as any[]) {
    applyRow(row, W.dislike, 'created_at');
    // An explicit dislike is a hard exclusion, not just a penalty.
    if (row?.file_id) suppressed.add(String(row.file_id).toLowerCase());
  }

  for (const row of (progressRes?.data ?? []) as any[]) {
    const dur = Number(row?.duration_s) || 0;
    const pos = Number(row?.current_time_s) || 0;
    if (dur <= 0) continue;
    const ratio = Math.max(0, Math.min(1, pos / dur));
    if (row?.file_id) completion.set(String(row.file_id).toLowerCase(), ratio);

    // Only treat a bail-out as negative on content long enough for the choice
    // to mean something — abandoning a 10s clip says nothing.
    let weight: number;
    if (ratio >= 0.8) weight = W.finished;
    else if (ratio >= 0.3) weight = W.engaged;
    else if (dur >= 30) weight = W.abandoned;
    else continue;

    applyRow(row, weight, 'updated_at');
  }

  // Subscriptions are a durable, deliberate statement of creator affinity, so
  // they're applied flat (no decay).
  for (const row of (subsRes?.data ?? []) as any[]) {
    if (row?.channel_id) {
      add(creators, String(row.channel_id), W.subscription);
      signals++;
    }
  }

  return {
    userId,
    creators: normalize(creators),
    categories: normalize(categories),
    completion,
    suppressed,
    hasSignal: signals >= 3,
  };
}

/**
 * Personalisation bonus for one candidate. Added on top of whatever similarity
 * score the caller already computed, so the base relevance still leads and this
 * tilts the ordering toward this particular viewer.
 */
export function personalizationBonus(
  profile: TasteProfile,
  row: { owner_id?: string | null; categories?: unknown; id?: string | null },
  opts?: { creatorWeight?: number; categoryWeight?: number },
): number {
  if (!profile.hasSignal) return 0;
  const creatorWeight = opts?.creatorWeight ?? 0.5;
  const categoryWeight = opts?.categoryWeight ?? 0.35;

  let bonus = 0;

  const owner = String(row.owner_id ?? '');
  if (owner) bonus += (profile.creators.get(owner) ?? 0) * creatorWeight;

  const cats = parseCats(row.categories);
  if (cats.length > 0) {
    let best = 0;
    for (const c of cats) best = Math.max(best, profile.categories.get(c) ?? 0);
    bonus += best * categoryWeight;
  }

  // Already finished it → strongly de-prioritise (they got what they came for).
  const id = String(row.id ?? '').toLowerCase();
  const done = profile.completion.get(id);
  if (done !== undefined && done >= 0.85) bonus -= 0.8;

  return bonus;
}

/**
 * Small deterministic exploration bonus.
 *
 * Pure exploitation collapses into a filter bubble: the same creators forever,
 * and taste can never grow. Big platforms all reserve a slice for discovery.
 * Deterministic in (userId, itemId) so it doesn't reshuffle on every request.
 */
export function explorationBonus(
  profile: TasteProfile,
  itemId: string,
  strength = 0.12,
): number {
  const key = `${profile.userId ?? 'anon'}:${itemId}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * strength;
}
