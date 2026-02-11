import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';
import { filterFilesByAccess } from '../fun/accessControl';

const RELATED_LIMIT = 20;

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

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const fileIdParam = url.searchParams.get('fileId') ?? url.searchParams.get('file_id');
    const cursorPosParam = url.searchParams.get('cursor_pos');
    const excludeParam = url.searchParams.get('exclude_ids');

    const cursorPos = cursorPosParam ? Math.max(0, parseInt(cursorPosParam, 10)) : 0;
    const excludeIds = parseIdsParam(excludeParam);
    const pExcludeIds =
      excludeIds.length > 0
        ? excludeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        : [];

    if (!fileIdParam || !/^[0-9a-f-]{36}$/i.test(fileIdParam)) {
      return new Response(
        JSON.stringify({ error: 'fileId (uuid) is required', data: [], userActions: { likedFileIds: [], dislikedFileIds: [] }, nextCursor: null }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    const rpcParams: Record<string, unknown> = {
      p_file_id: fileIdParam,
      p_user_id: userId || null,
      p_limit: RELATED_LIMIT,
      p_cursor_pos: Number.isFinite(cursorPos) ? cursorPos : 0,
      ...(pExcludeIds.length > 0 ? { p_exclude_ids: pExcludeIds } : {})
    };

    const { data: related, error } = await db.rpc('get_related', rpcParams);

    if (error) {
      console.error('get_related RPC error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch related', data: [], userActions: { likedFileIds: [], dislikedFileIds: [] }, nextCursor: null }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let filtered = await filterFilesByAccess(request, related || []);

    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];

    const data = filtered.map((file: Record<string, unknown>) => {
      if (file.user_has_liked) likedFileIds.push(file.id as string);
      if (file.user_has_disliked) dislikedFileIds.push(file.id as string);
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
        engagement_score: Number(file.engagement_score) ?? 0,
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

    const rawCount = (related || []).length;
    const nextCursor =
      rawCount > 0 ? { cursor_pos: cursorPos + rawCount } : null;

    return new Response(
      JSON.stringify({
        data,
        userActions: { likedFileIds, dislikedFileIds },
        nextCursor,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err) {
    console.error('Related videos error:', err);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        data: [],
        userActions: { likedFileIds: [], dislikedFileIds: [] },
        nextCursor: null,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
