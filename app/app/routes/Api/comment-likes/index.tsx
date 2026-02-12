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
      ).catch(() => {});
    }

    return toJson({ liked: true, success: true });
  } catch (error) {
    console.error("Error in comment-likes action:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
