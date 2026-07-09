import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { validateInteger } from "~/lib/Security/inputValidation";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const loader = async ({ request }: { request: Request }) => {
  try {
    // Notifications are private to the viewer  reject anonymous callers
    // outright instead of quietly returning an empty list.
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id) return toJson({ error: "Unauthorized" }, 401);
    if (!db) return toJson({ error: "Database not initialized" }, 500);

    const url = new URL(request.url);
    const countOnly = url.searchParams.get("count") === "1";
    if (countOnly) {
      const { count, error } = await db
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null);
      if (error) return toJson({ error: "Failed to get count" }, 500);
      return toJson({ unreadCount: count ?? 0, success: true });
    }

    const limit = validateInteger(url.searchParams.get("limit"), 1, 50) ?? 20;
    const offset = validateInteger(url.searchParams.get("offset"), 0, 10000) ?? 0;

    // Only the poster the inbox actually shows: default_thumbnail for videos,
    // endpoint for image posts (getThumbnailUrl uses it for image/* types).
    // The full thumbnails[] sprite array is NEVER sent  it leaks the whole
    // per-file frame/preview layout for nothing. is_adult stays so the renderer
    // can blur NSFW posters.
    const { data: rows, error } = await db
      .from("notifications")
      .select(
        "id, type, actor_id, file_id, comment_id, created_at, read_at, " +
          "users!actor_id(username, profile_pic), " +
          "files!file_id(unique_id, default_thumbnail, file_type, endpoint, created_at, filename, is_adult)",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("notifications loader error:", error);
      return toJson({ error: "Failed to load notifications" }, 500);
    }

    const unreadResult = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);

    return toJson({
      data: rows ?? [],
      unreadCount: unreadResult.count ?? 0,
      success: true,
    });
  } catch (e) {
    console.error("notifications loader:", e);
    return toJson({ error: "Internal server error" }, 500);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) return toJson({ error: "Unauthorized" }, 401);
    if (!db) return toJson({ error: "Database not initialized" }, 500);

    if (request.method === "PATCH") {
      const body = await request.json().catch(() => ({}));
      const { notificationId, markAllRead } = body;

      if (markAllRead === true) {
        const { error } = await db
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .is("read_at", null);
        if (error) return toJson({ error: "Failed to mark read" }, 500);
        return toJson({ success: true });
      }

      if (notificationId) {
        const { error } = await db
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", notificationId)
          .eq("user_id", user.id);
        if (error) return toJson({ error: "Failed to mark read" }, 500);
        return toJson({ success: true });
      }

      return toJson({ error: "notificationId or markAllRead required" }, 400);
    }

    return toJson({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error("notifications action:", e);
    return toJson({ error: "Internal server error" }, 500);
  }
};
