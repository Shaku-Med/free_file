/**
 * Pure shape adapter for AcoustID catalog → VideoCard FileType.
 * Kept client-safe (no DB / server imports).
 */

import type { FileType } from "~/lib/types";
import type { DynamicDeferredDetails } from "../types";

export function acoustidRecordingToFileType(
  recording: NonNullable<DynamicDeferredDetails["acoustidRecording"]>,
  host: { unique_id: string; created_at?: string | null },
): FileType {
  return {
    id: recording.id,
    unique_id: host.unique_id,
    file_title: recording.title || undefined,
    filename: "acoustid_cover.jpg",
    default_thumbnail: recording.cover_art_url,
    thumbnails: recording.cover_art_url ? [recording.cover_art_url] : undefined,
    created_at: host.created_at ?? "",
    view_count: 0,
    endpoint: "",
    file_type: "video",
    file_size: 0,
    duration: recording.duration ?? undefined,
    is_music: true,
  };
}
