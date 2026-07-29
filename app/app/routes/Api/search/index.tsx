import db from '~/lib/Database/supabase';
import { attachIsMusic } from '~/lib/files/attachIsMusic.server';
import { isAuthenticated } from '~/lib/Security/Password';
import { embedSearchQuery } from '~/lib/Services/embedQuery.server';
import { buildSpotlight } from '~/lib/search/spotlight.server';

const SEARCH_LIMIT = 20;
const SERIES_ROOTS_LIMIT = 8;

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

type SuggestItem = { text: string; kind: 'recent' | 'popular' | 'match' };

/**
 * Navbar dropdown completions. Empty query => the user's recent searches +
 * globally popular queries. Typed query => popularity-ranked query matches,
 * then content-title completions  all deduped, frequent matches first.
 */
async function buildSuggestItems(userId: string | null, rawQuery: string): Promise<SuggestItem[]> {
  const q = rawQuery.trim().slice(0, 80);
  const items: SuggestItem[] = [];
  const seen = new Set<string>();
  const push = (text: unknown, kind: SuggestItem['kind']) => {
    if (typeof text !== 'string') return;
    const t = text.trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) return;
    seen.add(key);
    items.push({ text: t, kind });
  };

  const { data: comps } = await db.rpc('get_search_completions', {
    p_user_id: userId,
    p_query: q,
    p_limit: 10,
  });
  if (Array.isArray(comps)) {
    for (const c of comps) {
      const kind = (c as { kind?: unknown })?.kind;
      if (kind === 'recent' || kind === 'popular' || kind === 'match') {
        push((c as { query?: unknown }).query, kind);
      }
    }
  }

  // Content-title completions only while typing, appended after frequent matches.
  if (q.length >= 1) {
    const { data: sugg } = await db.rpc('get_search_suggestions', { p_query: q, p_limit: 8 });
    if (Array.isArray(sugg)) {
      for (const r of sugg) push((r as { suggestion?: unknown }).suggestion, 'match');
    }
  }

  return items.slice(0, 12);
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    let query = url.searchParams.get('q')?.trim();
    // Cap the term so an oversized string can't drive an expensive RPC/DB scan.
    if (query && query.length > 200) query = query.slice(0, 200);
    // Navbar dropdown completions. Handled BEFORE the empty-query guard so an
    // empty box still returns recent + popular searches (YouTube-style).
    if (url.searchParams.get('suggest') === '1') {
      const sugUser = await isAuthenticated(request, ['id']).catch(() => null);
      let items: SuggestItem[] = [];
      try {
        items = await buildSuggestItems(sugUser?.id || null, query ?? '');
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

    const cursorScoreParam = url.searchParams.get('cursor_score');
    const cursorIdParam = url.searchParams.get('cursor_id');
    const sortBy = url.searchParams.get('sort_by') ?? 'relevance';
    const fileType = url.searchParams.get('file_type');
    const category = url.searchParams.get('category');

    const cursorScore = cursorScoreParam ? parseFloat(cursorScoreParam) : null;
    const cursorId = cursorIdParam ?? null;
    const isInitialSearch = !Number.isFinite(cursorScore) && !cursorId;

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    // Log the search once per submission (first page only) to power frequent /
    // recent suggestions. Best-effort  never blocks or fails the search.
    if (isInitialSearch) {
      void db
        .rpc('log_search_query', { p_user_id: userId || null, p_query: query })
        .then(() => {}, () => {});
    }

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

    // RPC rows don't carry is_music; add it so the card music icon shows.
    await attachIsMusic(db, data);
    if (seriesRootsMapped.length > 0) await attachIsMusic(db, seriesRootsMapped);

    const lastItem = data[data.length - 1];
    const nextCursor =
      lastItem && data.length >= SEARCH_LIMIT
        ? { cursor_score: lastItem.engagement_score, cursor_id: lastItem.id }
        : null;

    let users: Array<{ id: string; username: string; profile_pic: string; file_count: number }> = [];
    if (db && isInitialSearch) {
      // Escape LIKE wildcards so a user can't inject `%`/`_` to widen the match
      // (enumeration) or force expensive leading-wildcard scans.
      const likeSafe = query.replace(/[\\%_]/g, (c) => `\\${c}`);
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

    const spotlight = (db && isInitialSearch)
      ? await buildSpotlight(db, query, users)
      : null;

    return new Response(JSON.stringify({
      data,
      seriesRoots: seriesRootsMapped,
      users,
      spotlight,
      userActions: { likedFileIds, dislikedFileIds },
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
