import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';

const FEED_LIMIT = 20;

function parseIdsParam(param: string | null): string[] {
  if (!param) return [];

  try {
    const parsed = JSON.parse(param);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((id: any) => typeof id === 'string' && id.length > 0)
        .slice(0, 500);
    }
  } catch {
    return param
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .slice(0, 500);
  }

  return [];
}

function parseExcludeIds(url: URL): string[] {
  const seen = url.searchParams.get('seen');
  const exclude = url.searchParams.get('exclude_ids');
  const raw = exclude ?? seen;
  return parseIdsParam(raw);
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const fileTypeFilter = url.searchParams.get('file_type');
    const excludeIds = parseExcludeIds(url);
    const cursorPosParam = url.searchParams.get('cursor_pos');
    const seedParam = url.searchParams.get('seed') ?? 'default';

    const cursorPos = cursorPosParam ? Math.max(0, parseInt(cursorPosParam, 10)) : 0;
    const pExcludeIds =
      excludeIds.length > 0
        ? excludeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        : [];

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    // Only pass p_exclude_ids when we have IDs; some DB implementations treat
    // empty array differently (e.g. bad WHERE id NOT IN ()), so omit when empty.
    const feedParams: Record<string, unknown> = {
      p_user_id: userId || null,
      p_limit: FEED_LIMIT,
      p_category: null,
      p_reels_only: false,
      p_seed: seedParam,
      p_cursor_pos: Number.isFinite(cursorPos) ? cursorPos : 0,
      ...(pExcludeIds.length > 0 ? { p_exclude_ids: pExcludeIds } : {})
    };

    const { data: feed, error } = await db.rpc('get_feed', feedParams);

    if (error) {
      console.error('Feed RPC error:', error);
      return new Response(JSON.stringify({ error: 'Failed to fetch feed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let filteredFeed = await filterFilesByAccess(request, feed || []);

    if (fileTypeFilter) {
      const filter = fileTypeFilter.toLowerCase();
      filteredFeed = filteredFeed.filter((file: any) => {
        const type = (file.file_type || '').toLowerCase();
        const endpoint = file.endpoint || '';

        if (filter === 'video') {
          const isHls =
            type === 'application/vnd.apple.mpegurl' ||
            endpoint.includes('.m3u8');
          const isVideoType = type.startsWith('video/');
          return isHls || isVideoType;
        }

        return type === filter;
      });
    }

    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];

    const data = filteredFeed.map((file: any) => {
      if (file.user_has_liked) likedFileIds.push(file.id);
      if (file.user_has_disliked) dislikedFileIds.push(file.id);

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
        thumbnails: file.thumbnails || [],
        view_count: file.view_count,
        share_count: file.share_count,
        is_reel: file.is_reel,
        duration: file.duration,
        categories: file.categories,
        tags: file.tags,
        colors: file.colors,
        metadata: file.metadata,
        like_count: Number(file.like_count) || 0,
        dislike_count: Number(file.dislike_count) || 0,
        comment_count: Number(file.comment_count) || 0,
        engagement_score: file.engagement_score ?? 0,
        owner: file.owner_username
          ? {
              id: file.owner_id,
              username: file.owner_username,
              profile_pic: file.owner_profile_pic || '',
              verified: file.owner_verified ?? false,
              about: file.owner_about ?? null,
            }
          : null,
      };
    });

    // Don't mark as seen here — it would shrink the "unseen" set before load-more
    // requests, breaking cursor_pos pagination. Frontend marks on page leave instead.

    // Use position-based pagination: next page starts at cursorPos + rawCount.
    // Return a next cursor whenever we got any rows so load-more can run (pool-based
    // get_feed may return fewer than p_limit rows). When the next request returns 0 rows,
    // we'll send nextCursor: null and the client stops.
    const rawCount = (feed || []).length;
    const nextCursor =
      rawCount > 0
        ? { cursor_pos: cursorPos + rawCount }
        : null;

    const result = {
      data,
      userActions: { likedFileIds, dislikedFileIds },
      nextCursor
    };

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Feed-Raw-Count': String(rawCount)
      }
    });
  } catch (error) {
    console.error('Feed error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
