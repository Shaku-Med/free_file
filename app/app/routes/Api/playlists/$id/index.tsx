import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { normalizeRpcFileRow } from "~/lib/profile/normalizeRpcFileRow";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE = 100;
const MAX_DESC = 500;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stripTags(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

function isValidUuid(val: unknown): val is string {
  return typeof val === "string" && UUID_RE.test(val);
}

export const loader = async ({ request, params }: { request: Request; params: { id: string } }) => {
  if (!db) return jsonRes({ error: "Something went wrong" }, 503);
  if (!isValidUuid(params.id)) return jsonRes({ error: "Not found" }, 404);

  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const playlistId = params.id;

  const { data: rows, error } = await db.rpc("get_playlist_with_items", {
    p_playlist_id: playlistId,
    p_user_id: user?.id || null,
  });

  if (error) {
    console.error("[playlists] get_playlist_with_items error:", error);
    return jsonRes({ error: "Something went wrong" }, 500);
  }

  if (!rows || rows.length === 0) {
    return jsonRes({ error: "Playlist not found" }, 404);
  }

  const first = rows[0];
  const playlist = {
    id: first.playlist_id,
    title: first.playlist_title,
    description: first.playlist_desc,
    is_public: first.playlist_public,
    owner_id: first.playlist_owner_id,
    unique_id: first.playlist_unique_id,
    created_at: first.playlist_created,
    updated_at: first.playlist_updated,
    total_items: first.total_items,
  };

  const rawItems = first.item_id
    ? rows.map((r: any) => ({
        id: r.file_id,
        playlist_item_id: r.item_id,
        position: r.position,
        added_at: r.added_at,
        created_at: r.f_created_at,
        endpoint: r.f_endpoint,
        filename: r.f_filename,
        unique_id: r.f_unique_id,
        file_size: r.f_file_size,
        file_type: r.f_file_type,
        is_adult: r.f_is_adult,
        owner_id: r.f_owner_id,
        is_public: r.f_is_public,
        file_description: r.f_file_description,
        file_title: r.f_file_title,
        default_thumbnail: r.f_default_thumbnail || null,
        view_count: r.f_view_count,
        share_count: r.f_share_count,
        is_reel: r.f_is_reel,
        duration: r.f_duration,
        categories: r.f_categories,
        tags: r.f_tags,
        colors: r.f_colors,
        metadata: r.f_metadata,
        like_count: r.like_count,
        dislike_count: r.dislike_count,
        comment_count: r.comment_count,
        owner: r.owner_username
          ? {
              id: r.f_owner_id,
              username: r.owner_username,
              profile_pic: r.owner_profile_pic || "",
              verified: r.owner_verified ?? false,
            }
          : null,
      }))
    : [];

  const items = (await filterFilesByAccess(request, rawItems)).map((item) =>
    normalizeRpcFileRow(item as Record<string, unknown>)
  );

  return jsonRes({ playlist, items });
};

export const action = async ({ request, params }: { request: Request; params: { id: string } }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) return jsonRes({ error: "Unauthorized" }, 401);
  if (!db) return jsonRes({ error: "Something went wrong" }, 503);
  if (!isValidUuid(params.id)) return jsonRes({ error: "Not found" }, 404);

  const playlistId = params.id;
  const method = request.method;

  if (method === "PATCH") {
    let body: { title?: string; description?: string; is_public?: boolean };
    try {
      body = await request.json();
    } catch {
      return jsonRes({ error: "Invalid request" }, 400);
    }

    let title: string | null = null;
    if (body.title != null) {
      if (typeof body.title !== "string") return jsonRes({ error: "Invalid request" }, 400);
      title = stripTags(body.title).trim();
      if (!title || title.length > MAX_TITLE) {
        return jsonRes({ error: title ? "Title too long" : "Title cannot be empty" }, 400);
      }
    }

    let desc: string | null = null;
    if (body.description !== undefined) {
      desc = body.description != null ? stripTags(String(body.description)).trim() : "";
      if (desc.length > MAX_DESC) return jsonRes({ error: "Description too long" }, 400);
    }

    const { data, error } = await db.rpc("update_playlist", {
      p_user_id: user.id,
      p_playlist_id: playlistId,
      p_title: title,
      p_desc: desc,
      p_is_public: typeof body.is_public === "boolean" ? body.is_public : null,
    });

    if (error) {
      console.error("[playlists] update_playlist error:", error);
      return jsonRes({ error: "Something went wrong" }, 500);
    }
    if (!data) return jsonRes({ error: "Not found" }, 404);
    return jsonRes({ success: true });
  }

  if (method === "DELETE") {
    const { data, error } = await db.rpc("delete_playlist", {
      p_user_id: user.id,
      p_playlist_id: playlistId,
    });

    if (error) {
      console.error("[playlists] delete_playlist error:", error);
      return jsonRes({ error: "Something went wrong" }, 500);
    }
    if (!data) return jsonRes({ error: "Not found" }, 404);
    return jsonRes({ success: true });
  }

  if (method === "POST") {
    let body: { file_id?: string; action?: string; file_ids?: string[] };
    try {
      body = await request.json();
    } catch {
      return jsonRes({ error: "Invalid request" }, 400);
    }

    if (body.action === "remove" && body.file_id) {
      if (!isValidUuid(body.file_id)) return jsonRes({ error: "Invalid request" }, 400);

      const { data, error } = await db.rpc("remove_playlist_item", {
        p_user_id: user.id,
        p_playlist_id: playlistId,
        p_file_id: body.file_id,
      });
      if (error) {
        console.error("[playlists] remove_playlist_item error:", error);
        return jsonRes({ error: "Something went wrong" }, 500);
      }
      return jsonRes({ success: !!data });
    }

    if (body.action === "reorder" && Array.isArray(body.file_ids)) {
      if (body.file_ids.length === 0 || body.file_ids.length > 500) {
        return jsonRes({ error: "Invalid request" }, 400);
      }
      if (!body.file_ids.every(isValidUuid)) {
        return jsonRes({ error: "Invalid request" }, 400);
      }

      const { data, error } = await db.rpc("reorder_playlist_items", {
        p_user_id: user.id,
        p_playlist_id: playlistId,
        p_file_ids: body.file_ids,
      });
      if (error) {
        console.error("[playlists] reorder_playlist_items error:", error);
        return jsonRes({ error: "Something went wrong" }, 500);
      }
      return jsonRes({ success: !!data });
    }

    if (body.file_id && !body.action) {
      if (!isValidUuid(body.file_id)) return jsonRes({ error: "Invalid request" }, 400);

      const { data, error } = await db.rpc("add_playlist_item", {
        p_user_id: user.id,
        p_playlist_id: playlistId,
        p_file_id: body.file_id,
      });

      if (error) {
        console.error("[playlists] add_playlist_item error:", error);
        const msg = error.message || "";
        if (error.code === "23505" || msg.includes("duplicate")) {
          return jsonRes({ error: "Already in playlist" }, 409);
        }
        if (msg.includes("item limit")) {
          return jsonRes({ error: "Playlist is full" }, 429);
        }
        if (msg.includes("Not authorized")) {
          return jsonRes({ error: "Not found" }, 404);
        }
        return jsonRes({ error: "Something went wrong" }, 500);
      }

      const item = Array.isArray(data) ? data[0] : data;
      return jsonRes({ item }, 201);
    }

    return jsonRes({ error: "Invalid request" }, 400);
  }

  return jsonRes({ error: "Method not allowed" }, 405);
};
