import { filterFilesByAccess } from '../fun/accessControl';
import db from '~/lib/Database/supabase';
import { attachIsMusic } from '~/lib/files/attachIsMusic.server';
import { isAuthenticated } from '~/lib/Security/Password';

const TAG_LIMIT = 20;

export const loader = async ({ request, params }: { request: Request; params: { tagname: string } }) => {
  try {
    const tagname = params.tagname?.trim();
    if (!tagname) {
      return new Response(JSON.stringify({ data: [], userActions: { likedFileIds: [], dislikedFileIds: [] }, nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    const cursorScoreParam = url.searchParams.get('cursor_score');
    const cursorIdParam = url.searchParams.get('cursor_id');
    const sortBy = url.searchParams.get('sort_by') || 'best';

    const cursorScore = cursorScoreParam ? parseFloat(cursorScoreParam) : null;
    const cursorId = cursorIdParam ?? null;

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    const { data: tagFeed, error } = await db.rpc('get_by_tag', {
      p_tag: tagname,
      p_user_id: userId || null,
      p_limit: TAG_LIMIT,
      p_cursor_score: Number.isFinite(cursorScore) ? cursorScore : null,
      p_cursor_id: cursorId,
      p_sort_by: sortBy,
      p_reels_only: false
    });

    if (error) {
      console.error('get_by_tag RPC error:', error);
      return new Response(JSON.stringify({ error: 'Failed to fetch tag feed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let filtered = await filterFilesByAccess(request, tagFeed || []);

    const fileIds = filtered.map((f: any) => f.id).filter(Boolean);
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
            interactionsByFile.set(row.file_id as string, {
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

    const data = filtered.map((file: any) => {
      const interactions = file.id ? interactionsByFile.get(file.id) : undefined;
      const likeCount = interactions ? interactions.like_count : Number(file.like_count) || 0;
      const dislikeCount = interactions ? interactions.dislike_count : Number(file.dislike_count) || 0;
      const commentCount = interactions ? interactions.comment_count : Number(file.comment_count) || 0;
      const userHasLiked = interactions ? interactions.user_has_liked : !!file.user_has_liked;
      const userHasDisliked = interactions ? interactions.user_has_disliked : !!file.user_has_disliked;
      if (userHasLiked) likedFileIds.push(file.id);
      if (userHasDisliked) dislikedFileIds.push(file.id);

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
        engagement_score: file.tag_score ?? 0,
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

    await attachIsMusic(db, data);

    const lastItem = data[data.length - 1];
    const nextCursor =
      lastItem && data.length >= TAG_LIMIT
        ? {
            cursor_score: lastItem.engagement_score,
            cursor_id: lastItem.id
          }
        : null;

    const result = {
      data,
      userActions: { likedFileIds, dislikedFileIds },
      nextCursor
    };

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    console.error('Tag feed error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
