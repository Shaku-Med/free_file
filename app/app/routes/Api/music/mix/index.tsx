import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { stripThumbnailsForClient } from '~/lib/files/reelFilePayload';
import { mixGidFromSeed, seedFromMixGid } from '~/lib/music/mixId';

/**
 * GET /api/music/mix?seed=<unique_id>[&limit=25]
 *
 * The ONLINE half of Music Mix. The batch job (database/migrations/
 * music_mix_related.sql) precomputes co-occurrence pairs; this assembles an
 * actual playlist from them at request time.
 *
 * Layered candidates, strongest signal first — this matters because a young
 * library has almost no co-occurrence data yet, and a mix that returns nothing
 * is worse than a rougher one:
 *   1. co-occurrence  — "listeners of the seed also played X" (real taste)
 *   2. shared tags    — genre-ish overlap from files.categories
 *   3. same artist    — other tracks by the same uploader
 *   4. popular music  — filler so the queue is never short
 *
 * Then diversity + a seeded shuffle, because a raw nearest-neighbour list is
 * monotonous (same artist over and over) and reloading shouldn't reshuffle.
 *
 * No recursion: one lookup per request, never "the neighbour's own mix", so
 * there's no way to loop.
 */

const FILE_COLUMNS =
  'id, created_at, endpoint, filename, unique_id, file_size, file_type, is_adult, owner_id, is_public, upload_status, file_title, default_thumbnail, views, view_count, share_count, up_count, down_count, is_reel, duration, colors, metadata, original_file_id, categories, is_music';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
/** Pull a wider net than we return so diversity trimming has room to work. */
const CANDIDATE_POOL = 120;
/** Ceiling per uploader in the final list, so one artist can't own the mix. */
const MAX_PER_OWNER = 2;

const WEIGHT = { related: 1, category: 0.45, artist: 0.3, popular: 0.1 } as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

type FileRow = Record<string, unknown> & {
  id?: string;
  owner_id?: string | null;
  unique_id?: string;
  original_file_id?: string | null;
  categories?: unknown;
};

/** Same-audio re-uploads collapse to one logical track. */
function canonicalId(row: FileRow): string {
  return String(row.original_file_id || row.id || '').toLowerCase();
}

function parseCategories(value: unknown): string[] {
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
  // Case is PRESERVED on purpose: these strings go straight into a jsonb `@>`
  // containment check, which is case-SENSITIVE. Lower-casing them ("Music" ->
  // "music") silently matched zero rows and quietly disabled this whole layer.
  return raw
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c.length > 0 && c.length <= 64)
    .slice(0, 12);
}

/** Deterministic 32-bit hash → stable shuffle for a given seed+user. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lean projection for a queue row.
 *
 * ALLOWLIST, not a blocklist: the full files row carries analysis payload the
 * queue has no use for — vision labels, safeSearch verdicts, loudness, codec
 * details, file_size, internal linkage. Shipping that made each item ~40x
 * bigger than it needs to be and leaked internals. Only the fields VideoCard
 * actually reads survive (getThumbnailUrl needs file_type/endpoint/
 * default_thumbnail/thumbnails/created_at/unique_id/filename).
 */
function mapForClient(row: FileRow): Record<string, unknown> {
  const stripped = stripThumbnailsForClient(row) as FileRow;
  return {
    id: stripped.id,
    unique_id: stripped.unique_id,
    created_at: stripped.created_at,
    endpoint: stripped.endpoint,
    filename: stripped.filename,
    file_title: stripped.file_title,
    file_type: stripped.file_type,
    default_thumbnail: stripped.default_thumbnail,
    thumbnails: (stripped as { thumbnails?: unknown }).thumbnails,
    duration: stripped.duration,
    view_count: Number(stripped.view_count ?? stripped.views) || 0,
    is_reel: stripped.is_reel,
    is_music: stripped.is_music,
    is_adult: stripped.is_adult,
    owner_id: stripped.owner_id,
    like_count: Number(stripped.like_count ?? stripped.up_count) || 0,
    dislike_count: Number(stripped.dislike_count ?? stripped.down_count) || 0,
  };
}

/** Every candidate query shares these visibility rules. */
function visibleMusic(q: any) {
  return q
    .eq('is_music', true)
    .eq('is_public', true)
    .eq('is_adult', false)
    .eq('upload_status', 'complete');
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    if (!db) return json({ error: 'Service unavailable' }, 503);

    const url = new URL(request.url);

    // Accept either ?list=<gid> (shareable, what the watch page sends) or
    // ?seed=<unique_id> (direct). The gid IS the seed, so both resolve the same
    // way — that's why a mix link works for signed-out viewers too.
    const listParam = (url.searchParams.get('list') ?? '').trim();
    const seedParam = listParam
      ? seedFromMixGid(listParam)
      : (url.searchParams.get('seed') ?? '').trim();

    if (!seedParam || seedParam.length > 128 || !/^[A-Za-z0-9_-]+$/.test(seedParam)) {
      return json({ error: 'Invalid mix' }, 400);
    }

    const limitRaw = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    // Offset pagination over the ranked pool: the sidebar loads more as the
    // viewer scrolls instead of shipping the whole mix up front.
    const offsetRaw = Number(url.searchParams.get('offset'));
    const offset = Number.isFinite(offsetRaw)
      ? Math.min(Math.max(Math.trunc(offsetRaw), 0), 500)
      : 0;

    const user = await isAuthenticated(request, ['id']).catch(() => null);
    const userId = user?.id ?? null;

    // ---- seed --------------------------------------------------------------
    const { data: seedRow } = await db
      .from('files')
      .select(FILE_COLUMNS)
      .eq('unique_id', seedParam)
      .maybeSingle();

    const seed = seedRow as FileRow | null;
    if (
      !seed ||
      seed.is_public !== true ||
      seed.is_adult === true ||
      String(seed.upload_status ?? 'complete') !== 'complete'
    ) {
      return json({ error: 'Not found' }, 404);
    }

    const seedCanonical = canonicalId(seed);
    const seedCats = parseCategories(seed.categories);
    const seedOwner = seed.owner_id ? String(seed.owner_id) : '';

    // Exclude the seed and anything sharing its audio.
    const excluded = new Set<string>([seedCanonical, String(seed.id).toLowerCase()]);

    // scoreById accumulates across layers so a track backed by two signals
    // (co-play AND same genre) outranks one backed by a single signal.
    const scores = new Map<string, number>();
    const sources = new Map<string, string>();
    const bump = (id: string, add: number, src: string) => {
      const key = id.toLowerCase();
      scores.set(key, (scores.get(key) ?? 0) + add);
      if (!sources.has(key)) sources.set(key, src);
    };

    // ---- layer 1: co-occurrence ------------------------------------------
    const { data: relatedRows } = await db
      .from('music_related')
      .select('related_file_id, score')
      .eq('source_file_id', seedCanonical)
      .order('score', { ascending: false })
      .limit(CANDIDATE_POOL);

    const maxRelated =
      Array.isArray(relatedRows) && relatedRows.length > 0
        ? Math.max(...relatedRows.map((r: any) => Number(r.score) || 0), 0.000001)
        : 0;

    for (const r of (relatedRows ?? []) as any[]) {
      // Normalise to 0..1 so the weight below means the same thing regardless
      // of how dense the library's play data happens to be.
      const norm = maxRelated > 0 ? (Number(r.score) || 0) / maxRelated : 0;
      bump(String(r.related_file_id), WEIGHT.related * norm, 'related');
    }

    // ---- layers 2-4: cold-start fillers ----------------------------------
    // Run unconditionally but weighted lower: they widen a thin co-occurrence
    // list without displacing it, which is what makes this usable on day one.
    // categories is JSONB. `&&`/.overlaps() is an ARRAY operator and errors
    // here; `@>`/.contains() works and is what idx_files_categories_gin
    // (jsonb_path_ops) serves — but it must be given a JSON STRING, not a JS
    // array (an array serialises to a PostgREST array literal and Postgres
    // rejects it with "invalid input syntax for type json").
    //
    // One query per tag instead of a composed or() filter: tag values would
    // otherwise be interpolated into a filter string, and a comma or quote in a
    // category would break — or alter — the query.
    const catQueries = seedCats
      .slice(0, 3)
      .map((cat) =>
        visibleMusic(db.from('files').select(FILE_COLUMNS))
          .contains('categories', JSON.stringify([cat]))
          .order('view_count', { ascending: false })
          .limit(Math.ceil(CANDIDATE_POOL / 2)),
      );

    const [catResults, artistRes, popRes] = await Promise.all([
      catQueries.length > 0
        ? Promise.all(catQueries)
        : Promise.resolve([] as { data: FileRow[] | null }[]),
      seedOwner
        ? visibleMusic(db.from('files').select(FILE_COLUMNS))
            .eq('owner_id', seedOwner)
            .order('view_count', { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [] as FileRow[] }),
      visibleMusic(db.from('files').select(FILE_COLUMNS))
        .order('view_count', { ascending: false })
        .limit(CANDIDATE_POOL),
    ]);

    // Row cache keyed by files.id for everything we've seen.
    const rowsById = new Map<string, FileRow>();
    const ingest = (rows: unknown, weight: number, src: string) => {
      if (!Array.isArray(rows)) return;
      const n = rows.length || 1;
      rows.forEach((raw, i) => {
        const row = raw as FileRow;
        const id = String(row.id ?? '').toLowerCase();
        if (!id) return;
        rowsById.set(id, row);
        // Positional decay: rank within the layer still matters.
        bump(id, weight * (1 - i / (n * 1.25)), src);
      });
    };

    // Earlier tags are the stronger match, so decay each successive tag query.
    (catResults as { data: FileRow[] | null }[]).forEach((res, idx) => {
      ingest(res?.data, WEIGHT.category * (1 - idx * 0.2), 'category');
    });
    ingest(artistRes?.data, WEIGHT.artist, 'artist');
    ingest(popRes?.data, WEIGHT.popular, 'popular');

    // Co-occurrence gave us ids only — fetch any rows we don't already hold.
    const missing = [...scores.keys()].filter((id) => !rowsById.has(id));
    if (missing.length > 0) {
      const { data: fetched } = await visibleMusic(
        db.from('files').select(FILE_COLUMNS),
      ).in('id', missing.slice(0, 200));
      for (const raw of (fetched ?? []) as FileRow[]) {
        rowsById.set(String(raw.id ?? '').toLowerCase(), raw);
      }
    }

    // NOTE: no per-viewer adjustment here (no watch-history demotion, no taste
    // weighting). Those would reorder a shared mix per person and break the
    // "same positions as the original" guarantee.

    // ---- assemble ---------------------------------------------------------
    type Scored = { row: FileRow; score: number; source: string };
    const pool: Scored[] = [];
    const seenCanonical = new Set<string>(excluded);

    for (const [id, score] of scores) {
      const row = rowsById.get(id);
      if (!row) continue;
      if (row.is_music !== true || row.is_public !== true || row.is_adult === true) continue;
      if (String(row.upload_status ?? 'complete') !== 'complete') continue;
      const canon = canonicalId(row);
      if (seenCanonical.has(canon) || seenCanonical.has(id)) continue;
      seenCanonical.add(canon);

      // Score depends ONLY on the seed — never on who is asking. A mix is a
      // shareable list: open RD<seed> and you must see the same tracks in the
      // same positions as the person who sent it, exactly like YouTube. Any
      // per-viewer term here (taste, watch history, exploration jitter) would
      // silently reshuffle a shared link. Personalisation belongs to WHICH mix
      // gets surfaced in the feed, not to the contents of one.
      pool.push({ row, score, source: sources.get(id) ?? 'popular' });
    }

    // Seeded shuffle inside score bands, keyed on the SEED ONLY (no viewer id)
    // so the order is reproducible: the same gid yields the same list for
    // everyone, which is what makes a mix shareable.
    const rng = mulberry32(hashString(seedParam));
    pool.sort((a, b) => b.score - a.score);
    const BAND = 0.08;
    let i = 0;
    while (i < pool.length) {
      let j = i + 1;
      while (j < pool.length && pool[i].score - pool[j].score < BAND) j++;
      for (let k = j - 1; k > i; k--) {
        const swap = i + Math.floor(rng() * (k - i + 1));
        [pool[k], pool[swap]] = [pool[swap], pool[k]];
      }
      i = j;
    }

    // Artist cap, applied after shuffling so it trims fairly. Ordered over the
    // WHOLE pool first, then sliced — otherwise page 2 would re-rank and could
    // repeat items already shown on page 1.
    const perOwner = new Map<string, number>();
    const ordered: Scored[] = [];
    const overflow: Scored[] = [];
    for (const item of pool) {
      const owner = String(item.row.owner_id ?? '');
      const used = perOwner.get(owner) ?? 0;
      if (owner && used >= MAX_PER_OWNER) {
        overflow.push(item);
        continue;
      }
      perOwner.set(owner, used + 1);
      ordered.push(item);
    }
    // Backfill from the capped-out tracks rather than return a short mix — on a
    // small library there may not be enough distinct creators to honour the cap.
    ordered.push(...overflow);

    const total = ordered.length;
    const picked = ordered.slice(offset, offset + limit);

    const ownerIds = Array.from(
      new Set(picked.map((p) => String(p.row.owner_id ?? '')).filter(Boolean)),
    );
    const owners = new Map<string, unknown>();
    if (ownerIds.length > 0) {
      const { data: ownerRows } = await db
        .from('users')
        .select('id, username, profile_pic, verified')
        .in('id', ownerIds);
      for (const o of (ownerRows ?? []) as any[]) owners.set(String(o.id), o);
    }

    const items = picked.map((p) => ({
      ...mapForClient(p.row),
      owner: owners.get(String(p.row.owner_id ?? '')) ?? null,
    }));

    return json({
      // The shareable list id. Derived from the seed, so this link resolves for
      // anyone — including signed-out viewers.
      gid: mixGidFromSeed(String(seed.unique_id ?? '')),
      seed: { unique_id: seed.unique_id, file_title: seed.file_title ?? null },
      // How the mix was built — tells the UI whether this is a real taste-based
      // mix or mostly cold-start filler, and makes tuning debuggable.
      basis: {
        related: [...sources.values()].filter((s) => s === 'related').length,
        category: [...sources.values()].filter((s) => s === 'category').length,
        artist: [...sources.values()].filter((s) => s === 'artist').length,
        popular: [...sources.values()].filter((s) => s === 'popular').length,
      },
      count: items.length,
      total,
      offset,
      hasMore: offset + items.length < total,
      items,
    });
  } catch (err) {
    console.error('music mix error:', err);
    return json({ error: 'Something went wrong' }, 500);
  }
};
