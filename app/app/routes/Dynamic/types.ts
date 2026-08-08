import type { FileType, SeriesEpisodeGroup } from "~/lib/types";

export interface DynamicCachePayload {
  file: any;
  id: string;
  relatedVideos: FileType[];
  userLiked: boolean;
  userDisliked: boolean;
  likeCount: number;
  dislikeCount: number;
  userId: string | null;
  owner: { id: string; username: string; profile_pic: string; verified?: boolean } | null;
  channelStats: { subscriber_count: number; is_subscribed: boolean; notify: boolean } | null;
  commentsCount: number;
  relatedVideosUserActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  seriesEpisodes: SeriesEpisodeGroup[] | null;
  /** Present only when this page is a series main file and episodes were loaded (server-verified). */
  seriesContext: { fileSeriesId: string } | null;
  seriesVideosUserActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  /** Max watch seconds for signed-out preview; null when signed in or not applicable. */
  guestPreviewLimitSeconds: number | null;
}

export type FreshForBlend = DynamicCachePayload & { _deferredPending?: boolean };

/** Resolved after shell  interactions, channel row, comment count (loads in parallel). */
export type DynamicDeferredDetails = {
  userLiked: boolean;
  userDisliked: boolean;
  likeCount: number;
  dislikeCount: number;
  owner: { id: string; username: string; profile_pic: string; verified?: boolean } | null;
  channelStats: { subscriber_count: number; is_subscribed: boolean; notify: boolean } | null;
  commentsCount: number;
  relatedVideosUserActions: { likedFileIds: string[]; dislikedFileIds: string[] };
  /** Audio-fingerprint match: the ORIGINAL this file's sound came from (YouTube-style attribution). */
  originalSound: {
    id: string;
    unique_id: string;
    file_title: string | null;
    filename: string | null;
    default_thumbnail: string | null;
    thumbnails: string[] | null;
    created_at: string | null;
    ownerUsername: string | null;
  } | null;
  /** When THIS file is the original: public videos whose audio matched it. */
  soundRemixes: Array<{
    id: string;
    unique_id: string;
    file_title: string | null;
    filename: string | null;
    default_thumbnail: string | null;
    thumbnails: string[] | null;
    created_at: string | null;
    view_count: number;
    is_reel?: boolean;
    owner?: { id: string; username: string; profile_pic: string; verified?: boolean } | null;
  }>;
};
