/**
 * Merges a cached watch payload with a fresh one so a revalidation does not
 * flash stale counts or drop related videos the cache already had.
 */

import type { FileType } from "~/lib/types";
import type { DynamicCachePayload, FreshForBlend } from "../types";

export function blendDynamicData(cached: DynamicCachePayload, fresh: FreshForBlend): DynamicCachePayload {
  const freshRelatedById = new Map<string, FileType>();
  for (const v of fresh.relatedVideos) {
    if (v.id) freshRelatedById.set(String(v.id), v);
  }

  const blendedRelated = cached.relatedVideos.map(cv => {
    const fv = cv.id ? freshRelatedById.get(String(cv.id)) : undefined;
    if (fv) {
      freshRelatedById.delete(String(cv.id));
      return { ...cv, like_count: fv.like_count, dislike_count: fv.dislike_count, comment_count: fv.comment_count, view_count: fv.view_count, views: fv.views };
    }
    return cv;
  });

  for (const fv of freshRelatedById.values()) {
    blendedRelated.push(fv);
  }

  const mergedLiked = [...new Set([
    ...(cached.relatedVideosUserActions?.likedFileIds ?? []),
    ...(fresh.relatedVideosUserActions?.likedFileIds ?? []),
  ])];
  const mergedDisliked = [...new Set([
    ...(cached.relatedVideosUserActions?.dislikedFileIds ?? []),
    ...(fresh.relatedVideosUserActions?.dislikedFileIds ?? []),
  ])];

  const engagementPending = fresh._deferredPending === true;

  return {
    file: fresh.file,
    id: fresh.id,
    relatedVideos: blendedRelated,
    userLiked: engagementPending ? cached.userLiked : fresh.userLiked,
    userDisliked: engagementPending ? cached.userDisliked : fresh.userDisliked,
    likeCount: engagementPending ? cached.likeCount : fresh.likeCount,
    dislikeCount: engagementPending ? cached.dislikeCount : fresh.dislikeCount,
    userId: fresh.userId,
    owner: fresh.owner ?? cached.owner,
    channelStats: fresh.channelStats ?? cached.channelStats ?? null,
    commentsCount: engagementPending ? cached.commentsCount : fresh.commentsCount,
    relatedVideosUserActions: { likedFileIds: mergedLiked, dislikedFileIds: mergedDisliked },
    seriesEpisodes: fresh.seriesEpisodes,
    seriesContext: fresh.seriesContext,
    seriesVideosUserActions:
      fresh.seriesVideosUserActions ??
      (cached as Partial<DynamicCachePayload>).seriesVideosUserActions ??
      { likedFileIds: [], dislikedFileIds: [] },
    guestPreviewLimitSeconds: fresh.guestPreviewLimitSeconds ?? null,
  };
}

