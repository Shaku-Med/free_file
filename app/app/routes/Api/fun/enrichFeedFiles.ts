import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Applies live interaction counts and maps RPC feed rows to the shape the home/subscription UIs expect.
 */
export async function enrichFeedFilesWithInteractions(
  dbClient: SupabaseClient,
  filteredFeed: Record<string, unknown>[],
  userId: string | undefined | null
) {
  const fileIds = filteredFeed.map((f) => f.id).filter(Boolean) as string[];
  const interactionsByFile = new Map<
    string,
    {
      like_count: number;
      dislike_count: number;
      comment_count: number;
      user_has_liked: boolean;
      user_has_disliked: boolean;
    }
  >();

  if (fileIds.length > 0) {
    const { data: batch } = await dbClient.rpc('get_batch_interactions', {
      p_file_ids: fileIds,
      p_user_id: userId || null,
    });
    if (Array.isArray(batch)) {
      for (const row of batch) {
        if (row && typeof row === 'object' && 'file_id' in row && row.file_id) {
          interactionsByFile.set(row.file_id as string, {
            like_count: Number((row as { like_count?: unknown }).like_count) ?? 0,
            dislike_count: Number((row as { dislike_count?: unknown }).dislike_count) ?? 0,
            comment_count: Number((row as { comment_count?: unknown }).comment_count) ?? 0,
            user_has_liked: !!(row as { user_has_liked?: unknown }).user_has_liked,
            user_has_disliked: !!(row as { user_has_disliked?: unknown }).user_has_disliked,
          });
        }
      }
    }
  }

  const likedFileIds: string[] = [];
  const dislikedFileIds: string[] = [];

  const data = filteredFeed.map((file) => {
    const f = file as Record<string, unknown>;
    const id = f.id as string | undefined;
    const interactions = id ? interactionsByFile.get(id) : undefined;
    const likeCount = interactions ? interactions.like_count : Number(f.like_count) || 0;
    const dislikeCount = interactions ? interactions.dislike_count : Number(f.dislike_count) || 0;
    const commentCount = interactions ? interactions.comment_count : Number(f.comment_count) || 0;
    const userHasLiked = interactions ? interactions.user_has_liked : !!f.user_has_liked;
    const userHasDisliked = interactions ? interactions.user_has_disliked : !!f.user_has_disliked;
    if (userHasLiked && id) likedFileIds.push(id);
    if (userHasDisliked && id) dislikedFileIds.push(id);

    return {
      id: f.id,
      created_at: f.created_at,
      endpoint: f.endpoint || '',
      filename: f.filename,
      unique_id: f.unique_id,
      file_size: f.file_size,
      file_type: f.file_type,
      is_adult: f.is_adult,
      owner_id: f.owner_id,
      is_public: f.is_public,
      file_description: f.file_description,
      file_title: f.file_title || '',
      default_thumbnail: f.default_thumbnail || null,
      view_count: f.view_count,
      share_count: f.share_count,
      is_reel: f.is_reel,
      duration: f.duration,
      upload_status: f.upload_status,
      processing_progress: f.processing_progress,
      categories: f.categories,
      tags: f.tags,
      colors: f.colors,
      metadata: f.metadata,
      like_count: likeCount,
      dislike_count: dislikeCount,
      comment_count: commentCount,
      engagement_score: f.engagement_score ?? 0,
      owner: f.owner_username
        ? {
            id: f.owner_id,
            username: f.owner_username,
            profile_pic: f.owner_profile_pic || '',
            verified: f.owner_verified ?? false,
            about: f.owner_about ?? null,
          }
        : null,
    };
  });

  return { data, likedFileIds, dislikedFileIds };
}
