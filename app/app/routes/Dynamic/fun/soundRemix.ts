/**
 * Pure shape adapter, kept apart from loadDetails on purpose.
 *
 * The component renders sound remixes as video cards, so this has to stay
 * client-safe. Living beside the loader pulled CommentService (and through it
 * r2.server) into the client graph and failed the build.
 */

import type { FileType } from "~/lib/types";
import type { DynamicDeferredDetails } from "../types";

export function soundRemixToFileType(remix: DynamicDeferredDetails["soundRemixes"][number]): FileType {
  return {
    id: remix.id,
    unique_id: remix.unique_id,
    file_title: remix.file_title ?? undefined,
    filename: remix.filename ?? "",
    default_thumbnail: remix.default_thumbnail,
    thumbnails: remix.thumbnails ?? undefined,
    created_at: remix.created_at ?? "",
    view_count: remix.view_count,
    is_reel: remix.is_reel,
    owner: remix.owner ?? undefined,
    endpoint: "",
    file_type: "video",
    file_size: 0,
  };
}
