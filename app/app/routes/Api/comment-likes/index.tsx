import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId } from "~/lib/Security/inputValidation";
import { createNotification } from "~/lib/Services/NotificationService";
import { sendPushForNotification } from "~/lib/Services/PushService";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** GET ?commentId= — list users who liked (positive engagement only; no dislikes on comments). */
export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const commentId = url.searchParams.get("commentId");
    if (!commentId || !isValidFileId(commentId)) {
      return toJson({ error: "Invalid commentId" }, 400);
    }
    if (!db) {
      return toJson({ error: "Database unavailable" }, 503);
    }

    const { data: comment } = await db
      .from("comments")
      .select("id")
      .eq("id", commentId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (!comment) {
      return toJson({ error: "Comment not found" }, 404);
    }

    const { data: likeRows, error } = await db
      .from("comment_likes")
      .select("user_id, created_at")
      .eq("comment_id", commentId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[comment-likes] loader:", error);
      return toJson({ error: "Failed to load likes" }, 500);
    }

    const rows = likeRows ?? [];
    if (rows.length === 0) {
      return toJson({ success: true, users: [], total: 0 });
    }

    const userIds = [...new Set(rows.map((r) => r.user_id as string))];
    const { data: userRows } = await db
      .from("users")
      .select("id, username, profile_pic")
      .in("id", userIds);

    const byId = new Map(
      (userRows ?? []).map((u) => [
        u.id as string,
        {
          id: u.id as string,
          username: String((u as { username?: string }).username ?? ""),
          profile_pic: String((u as { profile_pic?: string }).profile_pic ?? ""),
        },
      ])
    );

    const viewer = await isAuthenticated(request, ["id"]).catch(() => null);
    const viewerId = viewer?.id ?? null;

    const CHUNK = 10;
    const enriched: Array<{
      id: string;
      username: string;
      profile_pic: string;
      subscriber_count: number;
      is_subscribed: boolean;
      notify: boolean;
    }> = [];

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const part = await Promise.all(
        chunk.map(async (row) => {
          const u = byId.get(row.user_id as string);
          if (!u) return null;
          const { data: statsResult, error: rpcErr } = await db.rpc("get_channel_stats", {
            p_user_id: u.id,
            p_viewer_id: viewerId,
          });
          if (rpcErr) {
            console.warn("[comment-likes] get_channel_stats", rpcErr);
            return {
              id: u.id,
              username: u.username,
              profile_pic: u.profile_pic,
              subscriber_count: 0,
              is_subscribed: false,
              notify: false,
            };
          }
          const parsed = statsResult
            ? typeof statsResult === "string"
              ? JSON.parse(statsResult)
              : statsResult
            : {};
          const p = parsed as { subscriber_count?: number; is_subscribed?: boolean; notify?: boolean };
          return {
            id: u.id,
            username: u.username,
            profile_pic: u.profile_pic,
            subscriber_count: Number(p.subscriber_count) || 0,
            is_subscribed: Boolean(p.is_subscribed),
            notify: Boolean(p.notify),
          };
        })
      );
      for (const item of part) {
        if (item) enriched.push(item);
      }
    }

    return toJson({ success: true, users: enriched, total: enriched.length });
  } catch (e) {
    console.error("Error in comment-likes loader:", e);
    return toJson({ error: "Internal server error" }, 500);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return toJson({ error: "Method not allowed" }, 405);
    }

    const body = await request.json().catch(() => ({}));
    const commentId = body?.commentId ?? body?.comment_id;

    if (!commentId || !isValidFileId(commentId)) {
      return toJson({ error: "Invalid commentId" }, 400);
    }

    if (!db) {
      return toJson({ error: "Database unavailable" }, 503);
    }

    const { data: existing } = await db
      .from("comment_likes")
      .select("id")
      .eq("user_id", user.id)
      .eq("comment_id", commentId)
      .maybeSingle();

    if (existing) {
      await db.from("comment_likes").delete().eq("id", existing.id);
      return toJson({ liked: false, success: true });
    }

    const { data: commentRow } = await db
      .from("comments")
      .select("user_id, file_id")
      .eq("id", commentId)
      .maybeSingle();

    await db.from("comment_likes").insert([{ user_id: user.id, comment_id: commentId }]);

    if (commentRow?.user_id) {
      await createNotification({
        userId: commentRow.user_id,
        type: "comment_like",
        actorId: user.id,
        fileId: commentRow.file_id ?? undefined,
        commentId,
      });
      sendPushForNotification(
        commentRow.user_id,
        "comment_like",
        user.id,
        commentRow.file_id ?? undefined
      ).catch((e) => console.error("[Push] comment_like failed:", e));
    }

    return toJson({ liked: true, success: true });
  } catch (error) {
    console.error("Error in comment-likes action:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
