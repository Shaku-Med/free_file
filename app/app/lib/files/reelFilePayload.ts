/**
 * Reel loaders/APIs never need the heavy `thumbnails` JSON array — only `default_thumbnail`.
 */

/** Columns for a single reel row in SSR loaders (no `thumbnails`). */
export const REEL_LOADER_FILE_COLUMNS = [
  "id",
  "created_at",
  "endpoint",
  "filename",
  "unique_id",
  "file_size",
  "file_type",
  "up_count",
  "down_count",
  "is_adult",
  "owner_id",
  "is_public",
  "file_description",
  "file_title",
  "default_thumbnail",
  "view_count",
  "share_count",
  "is_reel",
  "original_file_id",
  "duration",
  "categories",
  "tags",
  "colors",
  "metadata",
  "upload_status",
  "processing_progress",
  "github_repo",
].join(", ");

export function stripThumbnailsForClient<T extends Record<string, unknown>>(row: T): T {
  const { thumbnails: _omit, ...rest } = row;
  return rest as T;
}

export type ReelFeedInteraction = {
  like_count: number;
  dislike_count: number;
  comment_count: number;
  user_has_liked: boolean;
  user_has_disliked: boolean;
};

export function mapRpcFileToReelFeedItem(
  file: Record<string, unknown>,
  interactions?: ReelFeedInteraction,
): Record<string, unknown> {
  const rpcLike = Number(file.like_count) || 0;
  const rpcDislike = Number(file.dislike_count) || 0;
  const rpcComment = Number(file.comment_count) || 0;
  const likeCount = interactions ? Math.max(interactions.like_count, rpcLike) : rpcLike;
  const dislikeCount = interactions ? Math.max(interactions.dislike_count, rpcDislike) : rpcDislike;
  const commentCount = interactions ? Math.max(interactions.comment_count, rpcComment) : rpcComment;
  const userHasLiked = interactions ? interactions.user_has_liked : !!file.user_has_liked;
  const userHasDisliked = interactions ? interactions.user_has_disliked : !!file.user_has_disliked;

  return {
    id: file.id,
    created_at: file.created_at,
    endpoint: file.endpoint || "",
    filename: file.filename,
    unique_id: file.unique_id,
    file_size: file.file_size,
    file_type: file.file_type,
    is_adult: file.is_adult,
    owner_id: file.owner_id,
    is_public: file.is_public,
    file_description: file.file_description,
    file_title: file.file_title || "",
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
    user_has_liked: userHasLiked,
    user_has_disliked: userHasDisliked,
    owner: file.owner_username
      ? {
          id: file.owner_id,
          username: file.owner_username,
          profile_pic: file.owner_profile_pic || "",
          verified: file.owner_verified ?? false,
          about: file.owner_about ?? null,
        }
      : file.owner ?? null,
  };
}
