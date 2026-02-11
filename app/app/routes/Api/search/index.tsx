import db from '~/lib/Database/supabase';
import { isAuthenticated } from '~/lib/Security/Password';

const SEARCH_LIMIT = 20;

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

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim();
    if (!query) {
      return new Response(JSON.stringify({ data: [], userActions: { likedFileIds: [], dislikedFileIds: [] }, nextCursor: null }), {
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

    const user = await isAuthenticated(request, ['id']);
    const userId: string | undefined = user?.id || undefined;

    const { data: results, error } = await db.rpc('search_files', {
      p_query: query,
      p_user_id: userId || null,
      p_limit: SEARCH_LIMIT,
      p_file_type: fileType || null,
      p_category: category || null,
      p_sort_by: sortBy,
      p_cursor_score: Number.isFinite(cursorScore) ? cursorScore : null,
      p_cursor_id: cursorId
    });

    if (error) {
      console.error('Search RPC error:', error);
      return new Response(JSON.stringify({ error: 'Search failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];

    const data = (results || []).map((file: any) => {
      if (file.user_has_liked) likedFileIds.push(file.id);
      if (file.user_has_disliked) dislikedFileIds.push(file.id);
      return mapSearchFile(file);
    });

    const lastItem = data[data.length - 1];
    const nextCursor =
      lastItem && data.length >= SEARCH_LIMIT
        ? { cursor_score: lastItem.engagement_score, cursor_id: lastItem.id }
        : null;

    return new Response(JSON.stringify({
      data,
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
