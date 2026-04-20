import type { FileType } from '~/lib/types';

/**
 * Minimum shape the vertical feed needs to render a card.
 * Keep it structural so callers can pass `FileType` rows straight from
 * `/api/reel-feed` or map their own data into this shape.
 */
export interface VerticalFeedItemData {
  id: string;
  unique_id?: string;
  title: string;
  username: string;
  caption?: string;

  fileId?: string;
  likeCount?: number;
  dislikeCount?: number;
  commentCount?: number;
  liked?: boolean;
  disliked?: boolean;
  ownerId?: string;
  ownerProfilePic?: string | null;
  thumbnail?: string | null;
  createdAt?: string;
  /** Full file row for HLS / player when available (reel-feed, pip, etc.). */
  file?: FileType;
}

/** Map a backend `files` row / reel-feed entry into feed-item shape. */
export function fileToFeedItem(file: FileType): VerticalFeedItemData {
  return {
    id: String(file.id),
    unique_id: file.unique_id,
    fileId: String(file.id),
    title: file.file_title || file.filename || '',
    username: file.owner?.username || '',
    caption: file.file_description,
    likeCount: Number(file.like_count) || 0,
    dislikeCount: Number(file.dislike_count) || 0,
    commentCount: Number(file.comment_count) || 0,
    ownerId: file.owner_id,
    ownerProfilePic: file.owner?.profile_pic ?? null,
    thumbnail: file.default_thumbnail ?? null,
    createdAt: file.created_at,
  };
}

/** Shape the `/api/reel-feed` loader returns. */
export interface ReelFeedResponse {
  data: FileType[];
  userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  nextCursor: { cursor_pos: number } | null;
}

/** Shape of `GET /api/pip-feed?unique_id=` */
export interface PipFeedResponse {
  data: FileType[];
  userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  centerUniqueId: string;
  nextCursor?: { cursor_pos: number } | null;
  notFound?: boolean;
  accessDenied?: boolean;
  error?: string;
  reason?: string;
}
