import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import type { FileType } from "~/lib/types";
import { isValidUUID } from "~/lib/Security/inputValidation";
import { normalizeRpcFileRow } from "~/lib/profile/normalizeRpcFileRow";
import { mapPlaylistRpcToClientRow } from "~/lib/profile/normalizePlaylistRpcRow";

const TABS = new Set(["liked", "history", "playlists"]);

function mapFileRows(rows: unknown[], currentUserId: string | null): {
  files: FileType[];
  likedFileIds: string[];
  dislikedFileIds: string[];
} {
  const likedFileIds: string[] = [];
  const dislikedFileIds: string[] = [];
  const files: FileType[] = (rows as any[]).map((row) => {
    const r = normalizeRpcFileRow(row as Record<string, unknown>);
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

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const tab = url.searchParams.get("tab") || "";
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);

    if (!userId || !isValidUUID(userId)) {
      return data({ error: "Valid userId is required" }, { status: 400 });
    }

    if (!TABS.has(tab)) {
      return data({ error: "Invalid tab" }, { status: 400 });
    }

    if (page < 1 || limit < 1 || limit > 100) {
      return data({ error: "Invalid pagination parameters" }, { status: 400 });
    }

    if (!db) {
      return data({ error: "Database unavailable", data: [], playlists: [] }, { status: 500 });
    }

    const user = await isAuthenticated(request, ["id"]);
    const currentUserId = user?.id ?? null;
    const isOwner = currentUserId === userId;

    if (tab === "playlists") {
      const { data: raw, error } = await db.rpc("get_user_playlists", { p_user_id: userId });
      if (error) {
        console.error("get_user_playlists (profile-tab) error:", error);
        return data({ error: "Failed to load playlists", playlists: [] }, { status: 500 });
      }
      const list = Array.isArray(raw) ? raw : [];
      const filtered = list.filter((p: { is_public?: boolean }) => p.is_public === true || isOwner);
      const playlists = filtered.map((p: Record<string, unknown>) =>
        mapPlaylistRpcToClientRow(p)
      );
      return data({ playlists, tab }, { status: 200 });
    }

    if (!isOwner) {
      return data(
        {
          data: [],
          userActions: { likedFileIds: [], dislikedFileIds: [] },
          pagination: { page, limit, hasMore: false },
          tab,
        },
        { status: 200 }
      );
    }

    const cursorPos = (page - 1) * limit;
    const rpcName = tab === "liked" ? "get_profile_liked_files" : "get_profile_watch_history";
    const { data: rows, error: rpcError } = await db.rpc(rpcName, {
      p_profile_user_id: userId,
      p_viewer_id: currentUserId,
      p_limit: limit + 1,
      p_cursor_pos: cursorPos,
    });

    if (rpcError) {
      console.error(`${rpcName} error:`, rpcError);
      return data({ error: "Failed to fetch", data: [] }, { status: 500 });
    }

    const rowArr = Array.isArray(rows) ? rows : [];
    const hasMore = rowArr.length > limit;
    const sliced = rowArr.slice(0, limit);
    const { files, likedFileIds, dislikedFileIds } = mapFileRows(sliced, currentUserId);

    return data(
      {
        data: files,
        userActions: { likedFileIds, dislikedFileIds },
        pagination: { page, limit, hasMore },
        tab,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("profile-tab loader:", error);
    return data({ error: "Internal server error", data: [] }, { status: 500 });
  }
};
