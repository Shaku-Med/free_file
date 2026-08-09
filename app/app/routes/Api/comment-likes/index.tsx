import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId } from "~/lib/Security/inputValidation";
import { createNotification } from "~/lib/Services/NotificationService";
import { enqueuePush, cancelPush } from "~/lib/Services/PushQueue.server";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";
import { isSameOrigin } from "~/lib/Security/sameOrigin.server";
import { getCookie } from "~/lib/Security/Token";
import {
  validateRequestSignature,
  readBodyForSigning,
} from "~/lib/Security/requestSignature.server";
import { denyIfCommentUnreadable } from "~/routes/Api/fun/commentAccess.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });

function denyIfNotAppFetch(request: Request, opts?: { sameOrigin?: boolean }): Response | null {
  const blocked = assertSafeRequest(request, { apiFetchOnly: true });
  if (blocked) return blocked;
  if (opts?.sameOrigin && !isSameOrigin(request)) {
    return toJson({ error: "Forbidden" }, 403);
  }
  return null;
}

function denyIfBadSignature(
  request: Request,
  cookieValue: string,
  bodyBytes: Uint8Array | null,
): Response | null {
  const sig = validateRequestSignature(request, {
    cookieValue,
    bodyBytes,
  });
  if (sig.valid) return null;
  console.warn("[comment-likes] signature rejected:", sig.reason);
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  });
  if (
    sig.reason === "stale_ts" ||
    sig.reason === "hmac_mismatch" ||
    sig.reason === "missing_sig_headers"
  ) {
    headers.set("X-Sig-Stale", "1");
  }
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 401,
    headers,
  });
}

/** GET ?commentId=  list users who liked (positive engagement only; no dislikes on comments). */
export const loader = async ({ request }: { request: Request }) => {
  try {
    const gate = denyIfNotAppFetch(request);
    if (gate) return gate;

    const url = new URL(request.url);
    const commentId = url.searchParams.get("commentId");
    if (!commentId || !isValidFileId(commentId)) {
      return toJson({ error: "Invalid commentId" }, 400);
    }
    if (!db) {
      return toJson({ error: "Database unavailable" }, 503);
    }

    // The likes list names members. Signed in only, and the request has to
    // carry the browser HMAC so a stolen cookie alone is not enough.
    const viewer = await isAuthenticated(request, ["id"]).catch(() => null);
    const viewerId = viewer?.id ?? null;
    if (!viewerId) {
      return toJson({ error: "sign_in_required" }, 401);
    }
    const cookieValue = getCookie("c_user", request.headers);
    if (!cookieValue) return toJson({ error: "Unauthorized" }, 401);
    const badSig = denyIfBadSignature(request, cookieValue, null);
    if (badSig) return badSig;

    // Same file visibility + hidden branch rules as /api/comments. Knowing a
    // commentId must not reveal likers on a private or owner-hidden thread.
    const access = await denyIfCommentUnreadable(request, commentId, viewerId);
    if (access.denied) return access.denied;

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

    type LikeRow = { user_id: string; created_at?: string };
    type UserRow = { id: string; username?: string | null; profile_pic?: string | null };
    const rows = (likeRows ?? []) as LikeRow[];
    if (rows.length === 0) {
      return toJson({ success: true, users: [], total: 0 });
    }

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: userRows } = await db
      .from("users")
      .select("id, username, profile_pic")
      .in("id", userIds);

    type EnrichedUser = { id: string; username: string; profile_pic: string };
    const byId = new Map<string, EnrichedUser>(
      ((userRows ?? []) as UserRow[]).map((u) => [
        u.id,
        {
          id: u.id,
          username: String(u.username ?? ""),
          profile_pic: String(u.profile_pic ?? ""),
        },
      ])
    );

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
        chunk.map(async (row: LikeRow) => {
          const u = byId.get(row.user_id);
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
          const p = parsed as {
            subscriber_count?: number;
            is_subscribed?: boolean;
            notify?: boolean;
          };
          return {
            id: u.id,
            username: u.username,
            profile_pic: u.profile_pic,
            subscriber_count: Number(p.subscriber_count) || 0,
            is_subscribed: Boolean(p.is_subscribed),
            notify: Boolean(p.notify),
          };
        }),
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
    const gate = denyIfNotAppFetch(request, { sameOrigin: true });
    if (gate) return gate;

    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return toJson({ error: "Method not allowed" }, 405);
    }

    const cookieValue = getCookie("c_user", request.headers);
    if (!cookieValue) return toJson({ error: "Unauthorized" }, 401);
    const bodyReader = await readBodyForSigning(request);
    const badSig = denyIfBadSignature(request, cookieValue, bodyReader.bytes);
    if (badSig) return badSig;

    const body = bodyReader.json() as { commentId?: string; comment_id?: string };
    const commentId = body?.commentId ?? body?.comment_id;

    if (!commentId || !isValidFileId(commentId)) {
      return toJson({ error: "Invalid commentId" }, 400);
    }

    if (!db) {
      return toJson({ error: "Database unavailable" }, 503);
    }

    const access = await denyIfCommentUnreadable(request, commentId, user.id);
    if (access.denied) return access.denied;
    const fileId = access.comment.file_id;

    const { data: existing } = await db
      .from("comment_likes")
      .select("id")
      .eq("user_id", user.id)
      .eq("comment_id", commentId)
      .maybeSingle();

    if (existing) {
      await db.from("comment_likes").delete().eq("id", existing.id);
      const { data: ownerRow } = await db
        .from("comments")
        .select("user_id, file_id")
        .eq("id", commentId)
        .maybeSingle();
      if (ownerRow?.user_id) {
        void cancelPush(
          ownerRow.user_id,
          "comment_like",
          user.id,
          ownerRow.file_id ?? fileId,
          commentId,
        );
      }
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
        fileId: commentRow.file_id ?? fileId,
        commentId,
      });
      void enqueuePush(
        commentRow.user_id,
        "comment_like",
        user.id,
        commentRow.file_id ?? fileId,
        commentId,
      );
    }

    return toJson({ liked: true, success: true });
  } catch (error) {
    console.error("Error in comment-likes action:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
