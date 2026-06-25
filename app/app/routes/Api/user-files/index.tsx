import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { attachIsMusic } from "~/lib/files/attachIsMusic.server";
import type { FileType } from "~/lib/types";
import { normalizeRpcFileRow } from "~/lib/profile/normalizeRpcFileRow";
import { isValidUUID } from "~/lib/Security/inputValidation";
export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "20");

    if (!userId || !isValidUUID(userId)) {
      return data({ error: "Valid user ID is required" }, { status: 400 });
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return data({ error: "Invalid pagination parameters" }, { status: 400 });
    }

    if (!db) {
      return data({ error: "Database unavailable", data: [] }, { status: 500 });
    }

    const user = await isAuthenticated(request, ['id']);
    const currentUserId = (user && typeof user !== 'boolean') ? user.id : null;

    // cursor_pos is how many items to skip (page-based → cursor conversion)
    const cursorPos = (page - 1) * limit;

    const { data: rows, error: rpcError } = await db.rpc('get_profile_files', {
      p_profile_user_id: userId,
      p_viewer_id: currentUserId,
      p_limit: limit + 1,  // fetch one extra to detect hasMore
      p_cursor_pos: cursorPos,
    });

    if (rpcError) {
      console.error("get_profile_files error:", rpcError);
      return data({ error: "Failed to fetch files", data: [] }, { status: 500 });
    }

    const hasMore = Array.isArray(rows) && rows.length > limit;
    const sliced = Array.isArray(rows) ? rows.slice(0, limit) : [];

    const likedFileIds: string[] = [];
    const dislikedFileIds: string[] = [];

    const files: FileType[] = sliced.map((row: any) => {
      const r = normalizeRpcFileRow(row as Record<string, unknown>);
      const fid = String((r as { id: string }).id);
      if ((r as { user_has_liked?: boolean }).user_has_liked) likedFileIds.push(fid);
      if ((r as { user_has_disliked?: boolean }).user_has_disliked) dislikedFileIds.push(fid);
      return {
        ...r,
        like_count: Number(r["like_count"]) || 0,
        dislike_count: Number(r["dislike_count"]) || 0,
        comment_count: Number(r["comment_count"]) || 0,
        owner: r["owner_username"]
          ? {
              id: r["owner_id"] as string,
              username: r["owner_username"] as string,
              profile_pic: (r["owner_profile_pic"] as string) || "",
              verified: (r["owner_verified"] as boolean) || false,
              about: (r["owner_about"] as string | null) ?? null,
            }
          : null,
      } as FileType;
    });

    await attachIsMusic(db, files);

    return data(
      {
        data: files,
        userActions: { likedFileIds, dislikedFileIds },
        pagination: {
          page,
          limit,
          hasMore,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in user-files loader:", error);
    return data({ error: "Internal server error", data: [] }, { status: 500 });
  }
};
