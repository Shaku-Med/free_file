import db from '~/lib/Database/supabase';
import { attachIsMusic } from '~/lib/files/attachIsMusic.server';
import { isAuthenticated } from '~/lib/Security/Password';
import { embedSearchQuery } from '~/lib/Services/embedQuery.server';
import { buildSpotlight } from '~/lib/search/spotlight.server';
import { getPopularCompletions, logSearchQuery } from '~/lib/search/searchStats.server';
import { filterByOwnerStatus } from '~/lib/Security/accountStatus.server';
import { isValidUUID } from '~/lib/Security/inputValidation';
import {
  allowSearchRequest,
  allowSuggestRequest,
  escapeLikePattern,
  hasLexicalHit,
  withoutRestrictedOwners,
} from '~/lib/search/searchSafety.server';

const SEARCH_LIMIT = 20;
const SERIES_ROOTS_LIMIT = 8;

const SORTS = new Set(['relevance', 'recent', 'popular']);
const FILE_TYPE = /^(video|image|audio)(\/[a-z0-9.+-]{1,40})?$/;

function tooManyRequests(retryAfterSeconds: number) {
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfterSeconds),
    },
  });
}

/** Search cards only show a 2-line snippet, so trim long descriptions to a
 *  word boundary (~160 chars) here  keeps the payload light too. */
function shortDescription(desc: unknown): string {
  if (typeof desc !== 'string') return '';
  const trimmed = desc.replace(/\s+/g, ' ').trim();
  const MAX = 160;
  if (trimmed.length <= MAX) return trimmed;
  const slice = trimmed.slice(0, MAX);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 80 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…';
}

function mapSearchFile(file: any) {
  return {
    id: file.id,
    created_at: file.created_at,
    endpoint: file.endpoint || '',
    filename: file.filename,
    unique_id: file.unique_id,
    file_size: file.file_size,
    file_type: file.file_type,
    is_adult: file.is_adult,
    owner_id: file.owner_id,
    is_public: file.is_public,
    file_description: shortDescription(file.file_description),
    file_title: file.file_title || '',
    default_thumbnail: file.default_thumbnail || null,
    preview_endpoint: file.preview_endpoint || null,
    view_count: file.view_count,
    share_count: file.share_count,
    is_reel: file.is_reel,
    // Series fields  required for VideoCard badges + resume click logic.
    is_series_main: file.is_series_main,
    is_series_episode: file.is_series_episode,
    is_files_series_item: file.is_files_series_item,
    file_series_id: file.file_series_id,
    file_series_episode_id: file.file_series_episode_id,
    feed_reel_cluster_id:
      file.feed_reel_cluster_id != null && file.feed_reel_cluster_id !== ''
        ? Number(file.feed_reel_cluster_id)
        : null,
    duration: file.duration,
    categories: file.categories,
    tags: file.tags,
    colors: file.colors,
    metadata: file.metadata,
    like_count: Number(file.like_count) || 0,
    dislike_count: Number(file.dislike_count) || 0,
    comment_count: Number(file.comment_count) || 0,
    engagement_score: file.search_rank ?? 0,
    owner: file.owner_username
      ? {
          id: file.owner_id,
          username: file.owner_username,
          profile_pic: file.owner_profile_pic || '',
          verified: file.owner_verified ?? false,
        }
      : null,
  };
}

function dedupeSeriesByMainFiles(seriesRoots: ReturnType<typeof mapSearchFile>[], files: ReturnType<typeof mapSearchFile>[]) {
  const seen = new Set(files.map((f) => f.id).filter(Boolean));
  return seriesRoots.filter((s) => s.id && !seen.has(s.id));
}

type SuggestItem = {
  text: string;
  kind: 'popular' | 'match';
  /** Representative public video, for the dropdown thumbnail. Optional. */
  thumb?: { unique_id: string; created_at: string; default_thumbnail: string | null; filename: string } | null;
};

/**
 * PostgREST's `or=` filter is a comma and parenthesis delimited grammar, so a
 * raw suggestion interpolated into it could break out of its own condition and
 * rewrite the filter. Suggestions come from user search history, so treat them
 * as hostile: reduce to letters, digits and spaces, which cannot express any
 * part of that grammar, and cap the length.
 */
function safeIlikePrefix(text: string): string | null {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) return null;
  return cleaned.slice(0, 40);
}

/**
 * Attaches one public thumbnail per suggestion. Single query for the whole
 * list; anything without a confident match simply renders without an image.
 * Restricted to public, non-adult, finished uploads because this dropdown is
 * served to signed-out visitors too.
 */
async function attachSuggestionThumbs(items: SuggestItem[]): Promise<SuggestItem[]> {
  if (!db || items.length === 0) return items;

  const prefixes = new Map<string, string>();
  for (const it of items) {
    const p = safeIlikePrefix(it.text);
    if (p) prefixes.set(it.text, p);
  }
  if (prefixes.size === 0) return items;

  const ors = [...new Set(prefixes.values())]
    .slice(0, 12)
    // Contains, not prefix. Suggestions are query strings, so they almost
    // never start a title; matching on prefix returned a thumbnail for
    // essentially nothing. `*` is PostgREST's wildcard inside an or= filter.
    .map((p) => `file_title.ilike.*${p}*`)
    .join(',');

  try {
    const { data } = await db
      .from('files')
      .select('unique_id, created_at, file_title, filename, default_thumbnail, owner_id')
      .or(ors)
      .eq('is_public', true)
      .eq('is_adult', false)
      .eq('upload_status', 'complete')
      .limit(60);

    const rows = await filterByOwnerStatus(Array.isArray(data) ? data : [], null);
    return items.map((it) => {
      const p = prefixes.get(it.text);
      if (!p) return it;
      const hit = rows.find((r) =>
        String((r as { file_title?: unknown }).file_title ?? '').toLowerCase().includes(p),
      ) as Record<string, any> | undefined;
      if (!hit) return it;
      return {
        ...it,
        thumb: {
          unique_id: String(hit.unique_id),
          created_at: String(hit.created_at),
          default_thumbnail: hit.default_thumbnail ?? null,
          filename: String(hit.filename ?? ''),
        },
      };
    });
  } catch (e) {
    console.warn('[search] suggestion thumbs:', e instanceof Error ? e.message : e);
    return items;
  }
}

// Typed completions only. The empty box shows the device's own history, which
// never leaves the device, so there is nothing to return for it here.
async function buildSuggestItems(rawQuery: string): Promise<SuggestItem[]> {
  const q = rawQuery.trim().slice(0, 80);
  if (!q) return [];

  const items: SuggestItem[] = [];
  const seen = new Set<string>();
  const push = (text: unknown, kind: SuggestItem['kind']) => {
    if (typeof text !== 'string') return;
    const t = text.trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key) || key === q.toLowerCase()) return;
    seen.add(key);
    items.push({ text: t, kind });
  };

  const [popular, titles] = await Promise.all([
    getPopularCompletions(q, 8),
    db.rpc('get_search_suggestions', { p_query: q, p_limit: 8 }),
  ]);

  for (const text of popular) push(text, 'popular');
  if (Array.isArray(titles?.data)) {
    for (const r of titles.data) push((r as { suggestion?: unknown }).suggestion, 'match');
  }

  return attachSuggestionThumbs(items.slice(0, 10));
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    let query = url.searchParams.get('q')?.trim();
    // Cap the term so an oversized string can't drive an expensive RPC/DB scan.
    if (query && query.length > 200) query = query.slice(0, 200);
    if (url.searchParams.get('suggest') === '1') {
      if (!allowSuggestRequest(request)) return tooManyRequests(60);
      let items: SuggestItem[] = [];
      try {
        items = await buildSuggestItems(query ?? '');
      } catch (e) {
        console.warn('[search] completions:', e instanceof Error ? e.message : e);
      }
      return new Response(JSON.stringify({ items }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    if (!query) {
      return new Response(JSON.stringify({ data: [], seriesRoots: [], users: [], userActions: { likedFileIds: [], dislikedFileIds: [] }, nextCursor: null }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!allowSearchRequest(request)) return tooManyRequests(120);

    const cursorScoreParam = url.searchParams.get('cursor_score');
    const cursorIdParam = url.searchParams.get('cursor_id');
    const sortParam = url.searchParams.get('sort_by') ?? 'relevance';
    const sortBy = SORTS.has(sortParam) ? sortParam : 'relevance';
    const fileTypeParam = url.searchParams.get('file_type')?.trim().toLowerCase() ?? '';
    const fileType = FILE_TYPE.test(fileTypeParam) ? fileTypeParam : null;
    const categoryParam = url.searchParams.get('category')?.trim() ?? '';
    const category = categoryParam && categoryParam.length <= 60 ? categoryParam : null;

    const cursorScore = cursorScoreParam ? parseFloat(cursorScoreParam) : null;
    const cursorId = cursorIdParam && isValidUUID(cursorIdParam) ? cursorIdParam : null;
    const isInitialSearch = !Number.isFinite(cursorScore) && !cursorId;

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    // Semantic vector for the query (cached, ~10ms cold). Null when the
    // embed sidecar is down/unconfigured  search degrades to lexical-only.
    const queryEmbedding = await embedSearchQuery(query);

    const baseSearchParams = {
      p_query: query,
      p_user_id: userId || null,
      p_limit: SEARCH_LIMIT,
      p_file_type: fileType || null,
      p_category: category || null,
      p_sort_by: sortBy,
      p_cursor_score: Number.isFinite(cursorScore) ? cursorScore : null,
      p_cursor_id: cursorId,
    };

    const searchPromise = (async () => {
      if (queryEmbedding) {
        const withVector = await db.rpc('search_files', {
          ...baseSearchParams,
          p_query_embedding: queryEmbedding,
        });
        // PGRST202 = the DB hasn't run search_files_v6.sql yet, so the
        // function doesn't know p_query_embedding. Retry lexical-only
        // search must keep working regardless of SQL deploy order.
        if (withVector.error?.code !== 'PGRST202') return withVector;
        console.warn('[search] search_files has no p_query_embedding yet (run search_files_v6.sql)  lexical-only fallback');
      }
      return db.rpc('search_files', baseSearchParams);
    })();

    const seriesPromise =
      isInitialSearch && db
        ? db.rpc('search_series_roots_for_query', {
            p_query: query,
            p_user_id: userId || null,
            p_limit: SERIES_ROOTS_LIMIT,
          })
        : Promise.resolve({ data: null as unknown, error: null as unknown });

    const [{ data: results, error }, seriesResult] = await Promise.all([searchPromise, seriesPromise]);

    if (error) {
      console.error('Search RPC error:', error);
      return new Response(JSON.stringify({ error: 'Search failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rawList = results || [];
    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];

    const data = rawList.map((file: any) => {
      if (file.user_has_liked) likedFileIds.push(file.id);
      if (file.user_has_disliked) dislikedFileIds.push(file.id);
      return mapSearchFile(file);
    });

    let seriesRootsMapped: ReturnType<typeof mapSearchFile>[] = [];
    if (isInitialSearch) {
      if (seriesResult && typeof seriesResult === 'object' && 'error' in seriesResult && seriesResult.error) {
        console.error('search_series_roots_for_query RPC error:', seriesResult.error);
      } else {
        const rawSeries = (seriesResult as { data?: unknown }).data;
        const rawSeriesList = Array.isArray(rawSeries) ? rawSeries : [];
        seriesRootsMapped = rawSeriesList.map((file: any) => {
          if (file.user_has_liked) likedFileIds.push(file.id);
          if (file.user_has_disliked) dislikedFileIds.push(file.id);
          return mapSearchFile(file);
        });
        seriesRootsMapped = dedupeSeriesByMainFiles(seriesRootsMapped, data);
      }
    }

    // Cursor comes from the unfiltered page, otherwise hiding a restricted
    // owner's rows would end pagination early.
    const lastItem = data[data.length - 1];
    const nextCursor =
      lastItem && data.length >= SEARCH_LIMIT
        ? { cursor_score: lastItem.engagement_score, cursor_id: lastItem.id }
        : null;

    let users: Array<{ id: string; username: string; profile_pic: string; file_count: number }> = [];
    if (db && isInitialSearch) {
      const likeSafe = escapeLikePattern(query);
      const usersResult = await db
        .from('users')
        .select('id, username, profile_pic, file_count')
        .ilike('username', `%${likeSafe}%`)
        .eq('is_memories', false)
        .limit(10);
      if (!usersResult.error && Array.isArray(usersResult.data)) {
        users = (usersResult.data as Array<{ id: string; username: string; profile_pic: string; file_count: number | null }>)
          .map((u) => ({
            id: u.id,
            username: u.username,
            profile_pic: u.profile_pic || '',
            file_count: u.file_count ?? 0,
          }));
      }
    }

    const visible = await withoutRestrictedOwners({
      files: data,
      series: seriesRootsMapped,
      users,
      viewerId: userId ?? null,
      likedFileIds,
      dislikedFileIds,
    });

    // RPC rows don't carry is_music; add it so the card music icon shows.
    await attachIsMusic(db, visible.files);
    if (visible.series.length > 0) await attachIsMusic(db, visible.series);

    const spotlight = (db && isInitialSearch)
      ? await buildSpotlight(db, query, visible.users)
      : null;

    if (isInitialSearch && hasLexicalHit(query, visible)) {
      logSearchQuery(request, userId ?? null, query);
    }

    return new Response(JSON.stringify({
      data: visible.files,
      seriesRoots: visible.series,
      users: visible.users,
      spotlight,
      userActions: { likedFileIds: visible.likedFileIds, dislikedFileIds: visible.dislikedFileIds },
      nextCursor
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Search error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
