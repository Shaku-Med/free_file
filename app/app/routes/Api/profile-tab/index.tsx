import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { attachIsMusic } from "~/lib/files/attachIsMusic.server";
import { isValidUUID } from "~/lib/Security/inputValidation";
import { mapRpcFileRows } from "~/lib/profile/mapRpcFileRows";
import { mapPlaylistRpcToClientRow } from "~/lib/profile/normalizePlaylistRpcRow";

const TABS = new Set(["liked", "history", "playlists", "adult", "shorts", "videos", "popular"]);
/** Public per-section "See all" views (channel home sections). NOT owner-gated. */
const PUBLIC_SECTION_TABS = new Set(["shorts", "videos", "popular"]);

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

    // Public "See all" section views. Visibility (public-only for non-owners,
    // adult NEVER) is enforced inside get_profile_section_files, so these are
    // safe to serve to anyone — handled BEFORE the owner gate below.
    if (PUBLIC_SECTION_TABS.has(tab)) {
      const cursorPos = (page - 1) * limit;
      const { data: rows, error: rpcError } = await db.rpc("get_profile_section_files", {
        p_profile_user_id: userId,
        p_viewer_id: currentUserId,
        p_section: tab,
        p_limit: limit + 1,
        p_cursor_pos: cursorPos,
      });
      if (rpcError) {
        console.error("get_profile_section_files error:", rpcError);
        return data({ error: "Failed to fetch", data: [] }, { status: 500 });
      }
      const rowArr = Array.isArray(rows) ? rows : [];
      const hasMore = rowArr.length > limit;
      const sliced = rowArr.slice(0, limit);
      const { files, likedFileIds, dislikedFileIds } = mapRpcFileRows(sliced);
      await attachIsMusic(db, files);
      return data(
        {
          data: files,
          userActions: { likedFileIds, dislikedFileIds },
          pagination: { page, limit, hasMore },
          tab,
        },
        { status: 200 }
      );
    }

    // Everything past this point (liked / history / adult) is OWNER-ONLY.
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
    const rpcName =
      tab === "liked"
        ? "get_profile_liked_files"
        : tab === "adult"
          ? "get_profile_adult_files"
          : "get_profile_watch_history";
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
    const { files, likedFileIds, dislikedFileIds } = mapRpcFileRows(sliced);
    await attachIsMusic(db, files);

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
