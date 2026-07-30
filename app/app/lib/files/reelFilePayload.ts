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

/**
 * Player-safe view of `files.metadata`.
 *
 * The stored blob is an INTERNAL analysis record — vision labels, safeSearch
 * moderation verdicts, loudness measurements, music scoring, text analysis. None
 * of it belongs in a client payload: it exposes how content is moderated and
 * classified, and it's dead weight on every reel in the feed.
 *
 * ALLOWLIST, so anything the pipeline adds later stays server-side by default.
 * What survives is only what the player genuinely needs:
 *   - video width/height/aspect_ratio → size the frame BEFORE any bytes load,
 *     which is what stops the layout jumping once the video reports its own
 *     dimensions
 *   - has_audio → whether to enable the volume control on a silent clip
 */
export function sanitizeMetadataForClient(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, any>;
  const out: Record<string, unknown> = {};

  const v = m.video;
  if (v && typeof v === 'object') {
    const width = Number(v.width) || null;
    const height = Number(v.height) || null;
    out.video = {
      width,
      height,
      // Prefer the stored ratio; derive it when absent so the player always has
      // something to size with.
      aspect_ratio:
        typeof v.aspect_ratio === 'string' && v.aspect_ratio.includes(':')
          ? v.aspect_ratio
          : width && height
            ? `${width}:${height}`
            : null,
    };
  }

  const a = m.audio;
  if (a && typeof a === 'object') {
    out.audio = { has_audio: a.has_audio !== false };
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Strips internal columns from a file row before it reaches a client:
 * the storage backend name (`github_repo`) and the raw analysis `metadata`.
 */
export function sanitizeFileForClient<T extends Record<string, unknown>>(row: T): T {
  const { github_repo: _repo, ...rest } = row as Record<string, unknown>;
  if ('metadata' in rest) {
    rest.metadata = sanitizeMetadataForClient(rest.metadata);
  }
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
    // Analysis blob reduced to the player-relevant bits (see sanitizeMetadataForClient).
    metadata: sanitizeMetadataForClient(file.metadata),
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
