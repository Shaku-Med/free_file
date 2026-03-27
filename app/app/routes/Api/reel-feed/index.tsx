import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';

const REEL_LIMIT = 15;

function parseIdsParam(param: string | null): string[] {
  if (!param) return [];

  try {
    const parsed = JSON.parse(param);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((id: unknown) => typeof id === 'string' && id.length > 0)
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
    const excludeIds = parseExcludeIds(url);
    const cursorPosParam = url.searchParams.get('cursor_pos');
    const seedParam = url.searchParams.get('seed') ?? 'default';
    const categoryParam = url.searchParams.get('category');
    const maxDurationParam = url.searchParams.get('max_duration');

    const cursorPos = cursorPosParam ? Math.max(0, parseInt(cursorPosParam, 10)) : 0;
    const pExcludeIds =
      excludeIds.length > 0
        ? excludeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        : [];

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    const maxDuration = maxDurationParam != null && maxDurationParam !== ''
      ? parseFloat(maxDurationParam)
      : undefined;

    const reelParams: Record<string, unknown> = {
      p_user_id: userId || null,
      p_limit: REEL_LIMIT,
      p_category: categoryParam || null,
      p_seed: seedParam,
      p_cursor_pos: Number.isFinite(cursorPos) ? cursorPos : 0,
      ...(pExcludeIds.length > 0 ? { p_exclude_ids: pExcludeIds } : {}),
      ...(maxDuration != null && Number.isFinite(maxDuration) && maxDuration > 0 ? { p_max_duration: maxDuration } : {}),
    };

    const { data: reelFeed, error } = await db.rpc('get_reel_feed', reelParams);
    if (error) {
      console.error('Reel feed RPC error:', error);
      return new Response(JSON.stringify({ error: 'Failed to fetch reel feed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let filtered = await filterFilesByAccess(request, reelFeed || []);

    const fileIds = filtered.map((f) => f.id as string | undefined).filter(Boolean);
    const interactionsByFile = new Map<
      string,
      { like_count: number; dislike_count: number; comment_count: number; user_has_liked: boolean; user_has_disliked: boolean }
    >();
    if (fileIds.length > 0) {
      const { data: batch } = await db.rpc('get_batch_interactions', {
        p_file_ids: fileIds,
        p_user_id: userId || null,
      });
      if (Array.isArray(batch)) {
        for (const row of batch) {
          if (row?.file_id) {
            const fid = String(row.file_id);
            interactionsByFile.set(fid, {
              like_count: Number(row.like_count) ?? 0,
              dislike_count: Number(row.dislike_count) ?? 0,
              comment_count: Number(row.comment_count) ?? 0,
              user_has_liked: !!row.user_has_liked,
              user_has_disliked: !!row.user_has_disliked,
            });
          }
        }
      }
    }

    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];

    const data = filtered.map((file: Record<string, unknown>) => {
      const fid = file.id ? String(file.id) : '';
      const interactions = fid ? interactionsByFile.get(fid) : undefined;
      const likeCount = interactions ? interactions.like_count : Number(file.like_count) || 0;
      const dislikeCount = interactions ? interactions.dislike_count : Number(file.dislike_count) || 0;
      const commentCount = interactions ? interactions.comment_count : Number(file.comment_count) || 0;
      const userHasLiked = interactions ? interactions.user_has_liked : !!file.user_has_liked;
      const userHasDisliked = interactions ? interactions.user_has_disliked : !!file.user_has_disliked;
      if (userHasLiked) likedFileIds.push(file.id as string);
      if (userHasDisliked) dislikedFileIds.push(file.id as string);

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
        duration: file.duration,
        categories: file.categories,
        tags: file.tags,
        colors: file.colors,
        metadata: file.metadata,
        like_count: likeCount,
        dislike_count: dislikeCount,
        comment_count: commentCount,
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

    const rawCount = (reelFeed || []).length;
    const nextCursor =
      rawCount > 0
        ? { cursor_pos: cursorPos + rawCount }
        : null;

    const result = {
      data,
      userActions: { likedFileIds, dislikedFileIds },
      nextCursor,
    };

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Reel-Feed-Count': String(rawCount),
      },
    });
  } catch (error) {
    console.error('Reel feed error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
