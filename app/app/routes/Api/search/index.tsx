import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';

const SEARCH_LIMIT = 20;
const SERIES_ROOTS_LIMIT = 8;

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
    file_description: file.file_description,
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

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim();
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

    const searchPromise = db.rpc('search_files', {
      p_query: query,
      p_user_id: userId || null,
      p_limit: SEARCH_LIMIT,
      p_file_type: fileType || null,
      p_category: category || null,
      p_sort_by: sortBy,
      p_cursor_score: Number.isFinite(cursorScore) ? cursorScore : null,
      p_cursor_id: cursorId,
    });

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

    const lastItem = data[data.length - 1];
    const nextCursor =
      lastItem && data.length >= SEARCH_LIMIT
        ? { cursor_score: lastItem.engagement_score, cursor_id: lastItem.id }
        : null;

    let users: Array<{ id: string; username: string; profile_pic: string; file_count: number }> = [];
    if (db && isInitialSearch) {
      const usersResult = await db
        .from('users')
        .select('id, username, profile_pic, file_count')
        .ilike('username', `%${query}%`)
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

    return new Response(JSON.stringify({
      data,
      seriesRoots: seriesRootsMapped,
      users,
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
