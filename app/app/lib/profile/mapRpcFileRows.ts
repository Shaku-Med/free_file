import type { FileType } from "~/lib/types";
import { normalizeRpcFileRow } from "~/lib/profile/normalizeRpcFileRow";

/**
 * Maps profile/library RPC rows (get_profile_liked_files, get_profile_watch_history,
 * get_profile_section_files, ...) to client FileType, collecting the viewer's
 * like/dislike ids along the way. Shared by /api/profile-tab and /library.
 */
export function mapRpcFileRows(rows: unknown[]): {
  files: FileType[];
  likedFileIds: string[];
  dislikedFileIds: string[];
} {
  const likedFileIds: string[] = [];
  const dislikedFileIds: string[] = [];
  const files: FileType[] = (rows as Record<string, unknown>[]).map((row) => {
    const r = normalizeRpcFileRow(row);
    const fid = String((r as { id: string }).id);
    if ((r as { user_has_liked?: boolean }).user_has_liked) likedFileIds.push(fid);
    if ((r as { user_has_disliked?: boolean }).user_has_disliked) dislikedFileIds.push(fid);
    return {
      ...r,
      like_count: Number(r["like_count"]) || 0,
      dislike_count: Number(r["dislike_count"]) || 0,
      comment_count: Number(r["comment_count"]) || 0,
      owner: (r as { owner_username?: string }).owner_username
        ? {
            id: (r as { owner_id: string }).owner_id,
            username: (r as { owner_username: string }).owner_username,
            profile_pic: (r as { owner_profile_pic?: string }).owner_profile_pic || "",
            verified: (r as { owner_verified?: boolean }).owner_verified || false,
            about: (r as { owner_about?: string | null }).owner_about || null,
          }
        : null,
    } as FileType;
  });
  return { files, likedFileIds, dislikedFileIds };
}
