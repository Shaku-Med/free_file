import type { FileVisibility } from '~/lib/Security/visibility';
import type { OwnerInfo } from '~/components/OwnerProfile/OwnerProfile';

export interface FileType {
  id: string;
  created_at: string;
  endpoint: string;
  filename: string;
  unique_id: string;
  file_type: string;
  file_size: string | number;
  /** Audio-fingerprint match: files.id of the ORIGINAL this sound came from. */
  original_file_id?: string | null;
  /** Display info of the matched original (Instagram-style sound chip). */
  original_sound?: {
    unique_id: string;
    file_title: string | null;
    filename: string | null;
    default_thumbnail: string | null;
    created_at: string | null;
  } | null;
  is_adult?: boolean;
  up_count?: number;
  down_count?: number;
  like_count?: number;
  dislike_count?: number;
  comment_count?: number;
  views?: number;
  view_count?: number;
  shares?: number;
  share_count?: number;
  owner_id?: string;
  owner?: OwnerInfo | null;
  /** Legacy mirror of `visibility`, kept in sync by a database trigger. */
  is_public?: boolean;
  /** Absent on payloads that only carry public rows, where the is_public
   *  fallback is already correct. */
  visibility?: FileVisibility;
  /** Owner-facing only: moderation holds visibility and the owner cannot move it. */
  visibility_locked?: boolean;
  /** Storage path of the hover preview mp4; derived from default_thumbnail when absent. */
  preview_endpoint?: string | null;
  file_description?: string;
  category?: string[];
  categories?: string[];
  tags?: string[];
  colors?: unknown;
  metadata?: unknown;
  file_title?: string;
  thumbnails?: string[];
  default_thumbnail?: string | null;
  upload_status?: string;
  /** 0–100 while processing; null/undefined when complete */
  processing_progress?: number | null;
  is_reel?: boolean;
  /** Detected as music (audio track / music video). Shows the card music icon. */
  is_music?: boolean;
  /** From feed RPCs: consecutive reels in one response share the same id (see feed_smart_v5). */
  feed_reel_cluster_id?: number | null;
  /** Series hub video (playlist root). */
  is_series_main?: boolean;
  /** Episode row; API/DB may use `is_files_series_item` instead. */
  is_series_episode?: boolean;
  is_files_series_item?: boolean;
  /** UUID of the series this file belongs to (cover or episode item). */
  file_series_id?: string | null;
  /** UUID of the specific episode row this file is linked to. */
  file_series_episode_id?: string | null;
  duration?: number;
  engagement_score?: number;
  comments_enabled?: boolean;
  /** null/undefined = unlimited; 0 = no comments allowed; positive = max visible comments */
  comment_limit?: number | null;
  /** Caption tracks  may arrive as language code strings or {language,path} objects from the DB. */
  captions?: (string | { language: string; path?: string })[];
}

import { buildReelWatchPath, type ReelWatchPathOptions } from "~/lib/reel/reelProfileContext";

/** In-app watch URL: reels use `/reel/:unique_id` (optional `/username` from profile); other files use `/:unique_id`. */
export function fileWatchPath(
  data: Pick<FileType, "is_reel" | "id" | "unique_id">,
  options?: ReelWatchPathOptions,
): string {
  if (data.is_reel) {
    const slug = data.unique_id ?? data.id;
    if (slug) return buildReelWatchPath(String(slug), options?.profileOwnerUsername);
  }
  return `/${data.unique_id}`;
}

/** Episodes returned for a series main file on the dynamic page */
export interface SeriesEpisodeGroup {
  episode_id: string;
  episode_name: string;
  episode_number: number | null;
  /** When set, this episode is nested under another episode in the same series */
  parent_episode_id: string | null;
  items: FileType[];
  /** Child episodes (nested under this one), in tree order */
  nested?: SeriesEpisodeGroup[];
}

/** Session-scoped cache for GET /api/dynamic-series (key: `file_series_id`). */
export type DynamicSeriesPayloadCache = {
  episodes: SeriesEpisodeGroup[] | null;
  userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
};

/** Session-scoped cache for related-videos bootstrap (key: server file `id`). */
export type RelatedVideosPayloadCache = {
  videos: FileType[];
  userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
};

/**
 * Persistent strip for the image watch carousel. Lives in the root context so
 * swiping + the per-image router refresh never lose the images already loaded
 * The viewer can always swipe back, and new images only ever append.
 */
export type ImageCarouselCache = {
  items: Array<Record<string, unknown>>;
  cursor: number;
  hasMore: boolean;
  /** unique_ids already in `items` (dedup + "is this image part of the strip?"). */
  seen: string[];
};

/**
 * Per-image content fetched from GET /api/content/:id (reel-style light load).
 * Cached by unique_id in the root context so swiping back to an image never
 * re-fetches its title / likes / owner / counts.
 */
export type ImageContentPayload = {
  file: FileType;
  owner: { id: string; username: string; profile_pic: string; verified: boolean } | null;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  userLiked: boolean;
  userDisliked: boolean;
};

export interface PageCacheData {
  data: unknown;
  currentPageNumber: number;
  nextPageNumber: number;
  totalPages: number;
  hasMore: boolean;
}

export type PageCacheEntry = Array<Record<string, PageCacheData>>;