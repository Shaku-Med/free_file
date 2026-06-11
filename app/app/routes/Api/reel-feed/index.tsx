import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';

const REEL_LIMIT = 15;

/** UUID string compare-safe key (Supabase/JSON may vary in casing). */
function fileIdKey(id: unknown): string {
  return String(id ?? "").toLowerCase();
}

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
    const seedParam = url.searchParams.get('seed') ?? 'default';
    const categoryParam = url.searchParams.get('category');
    const maxDurationParam = url.searchParams.get('max_duration');

    const pExcludeIds =
      excludeIds.length > 0
        ? excludeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        : [];

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    const maxDuration = maxDurationParam != null && maxDurationParam !== ''
      ? parseFloat(maxDurationParam)
      : undefined;

    const sessionCatsParam = url.searchParams.get('session_cats');
    const sessionCats: string[] = sessionCatsParam
      ? (() => {
          try {
            const parsed = JSON.parse(sessionCatsParam);
            return Array.isArray(parsed) ? parsed.filter((c: unknown) => typeof c === 'string').slice(0, 20) : [];
          } catch { return []; }
        })()
      : [];

    const watchedIdsParam = url.searchParams.get('watched_ids');
    const watchedIds: string[] = watchedIdsParam
      ? (() => {
          try {
            const parsed = JSON.parse(watchedIdsParam);
            return Array.isArray(parsed)
              ? parsed.filter((id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id as string)).slice(0, 50)
              : [];
          } catch { return []; }
        })()
      : [];

    const reelParams: Record<string, unknown> = {
      p_user_id: userId || null,
      p_limit: REEL_LIMIT,
      p_category: categoryParam || null,
      p_seed: seedParam,
      p_cursor_pos: 0,
      ...(pExcludeIds.length > 0 ? { p_exclude_ids: pExcludeIds } : {}),
      ...(maxDuration != null && Number.isFinite(maxDuration) && maxDuration > 0 ? { p_max_duration: maxDuration } : {}),
      ...(sessionCats.length > 0 ? { p_session_cats: sessionCats } : {}),
      ...(watchedIds.length > 0 ? { p_watched_ids: watchedIds } : {}),
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
      const { data: batch } = await db.rpc("get_batch_interactions", {
        p_file_ids: fileIds,
        p_user_id: userId || null,
      });
      if (Array.isArray(batch)) {
        for (const row of batch) {
          if (row?.file_id) {
            const fid = fileIdKey(row.file_id);
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
      const fid = file.id ? fileIdKey(file.id) : "";
      const interactions = fid ? interactionsByFile.get(fid) : undefined;
      const rpcLike = Number(file.like_count) || 0;
      const rpcDislike = Number(file.dislike_count) || 0;
      const rpcComment = Number(file.comment_count) || 0;
      const likeCount = interactions
        ? Math.max(interactions.like_count, rpcLike)
        : rpcLike;
      const dislikeCount = interactions
        ? Math.max(interactions.dislike_count, rpcDislike)
        : rpcDislike;
      const commentCount = interactions
        ? Math.max(interactions.comment_count, rpcComment)
        : rpcComment;
      const userHasLiked = interactions ? interactions.user_has_liked : !!file.user_has_liked;
      const userHasDisliked = interactions ? interactions.user_has_disliked : !!file.user_has_disliked;
      if (userHasLiked && file.id) likedFileIds.push(fileIdKey(file.id));
      if (userHasDisliked && file.id) dislikedFileIds.push(fileIdKey(file.id));

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
        original_file_id: file.original_file_id ?? null,
        original_sound: file.original_unique_id
          ? {
              unique_id: file.original_unique_id,
              file_title: file.original_title ?? null,
              filename: file.original_filename ?? null,
              default_thumbnail: file.original_default_thumbnail ?? null,
              created_at: file.original_created_at ?? null,
            }
          : null,
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
    /** Full page ⇒ more reels may exist; client uses exclude_ids + new seed (not cursor slice). */
    const nextCursor = rawCount >= REEL_LIMIT ? { cursor_pos: 0 } : null;

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
