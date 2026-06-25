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

  // is_music isn't returned by the feed RPCs, so fetch it for these files and
  // merge it in (drives the card music icon). Wrapped so it no-ops cleanly
  // until the add_is_music migration has run.
  const musicFileIds = new Set<string>();
  if (fileIds.length > 0) {
    try {
      const { data: musicRows } = await dbClient
        .from('files')
        .select('id, is_music')
        .in('id', fileIds);
      if (Array.isArray(musicRows)) {
        for (const r of musicRows) {
          const row = r as { id?: unknown; is_music?: unknown };
          if (row.is_music === true && typeof row.id === 'string') musicFileIds.add(row.id);
        }
      }
    } catch {
      // column may not exist yet; cards just won't show the icon
    }
  }

  const likedFileIds: string[] = [];
  const dislikedFileIds: string[] = [];
  const savedFileIds: string[] = [];

  const data = filteredFeed.map((file) => {
    const f = file as Record<string, unknown>;
    const id = f.id as string | undefined;
    const interactions = id ? interactionsByFile.get(id) : undefined;
    const rpcLike = Number(f.like_count) || 0;
    const rpcDislike = Number(f.dislike_count) || 0;
    const rpcComment = Number(f.comment_count) || 0;
    // Batch RPC can lag or return 0; keep feed/RPC counts as floor so PiP and feeds don't show 0 incorrectly.
    const likeCount = interactions
      ? Math.max(interactions.like_count, rpcLike)
      : rpcLike;
    const dislikeCount = interactions
      ? Math.max(interactions.dislike_count, rpcDislike)
      : rpcDislike;
    const commentCount = interactions
      ? Math.max(interactions.comment_count, rpcComment)
      : rpcComment;
    const userHasLiked = interactions ? interactions.user_has_liked : !!f.user_has_liked;
    const userHasDisliked = interactions ? interactions.user_has_disliked : !!f.user_has_disliked;
    const userHasSaved = !!f.user_has_saved;
    if (userHasLiked && id) likedFileIds.push(id);
    if (userHasDisliked && id) dislikedFileIds.push(id);
    if (userHasSaved && id) savedFileIds.push(id);

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
      // Series fields  required for VideoCard badges + resume click logic.
      is_series_main: f.is_series_main,
      is_series_episode: f.is_series_episode,
      is_files_series_item: f.is_files_series_item,
      file_series_id: f.file_series_id,
      file_series_episode_id: f.file_series_episode_id,
      feed_reel_cluster_id:
        f.feed_reel_cluster_id != null && f.feed_reel_cluster_id !== ''
          ? Number(f.feed_reel_cluster_id)
          : null,
      duration: f.duration,
      upload_status: f.upload_status,
      processing_progress: f.processing_progress,
      is_music: id ? musicFileIds.has(id) : false,
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

  return { data, likedFileIds, dislikedFileIds, savedFileIds };
}
