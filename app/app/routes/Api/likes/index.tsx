import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId } from "~/lib/Security/inputValidation";
import { createNotification } from "~/lib/Services/NotificationService";
import { enqueuePush, cancelPush } from "~/lib/Services/PushQueue.server";
import { checkInteractionRateLimit } from "~/routes/Api/fun/personalizationRateLimit";
import { recordFileTaste } from "~/lib/Services/taste.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user?.id || !db) return toJson({ liked: false }, 200);
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');
    if (!fileId || !isValidFileId(fileId)) return toJson({ error: "Invalid fileId" }, 400);
    const { data } = await db.from('likes').select('id').eq('user_id', user.id).eq('file_id', fileId).maybeSingle();
    return toJson({ liked: !!data }, 200);
  } catch {
    return toJson({ liked: false }, 200);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({ error: "Unauthorized" }, 401);
    if (!db) return toJson({ error: "Database not initialized" }, 500);
    if (!checkInteractionRateLimit(request, user.id).allowed) {
      return toJson({ error: "Too many requests" }, 429);
    }
    const body = await request.json();
    const fileId = body?.fileId;
    if (!fileId || !isValidFileId(fileId)) return toJson({ error: "Invalid fileId" }, 400);
    const { data, error } = await db.rpc('toggle_like', { p_user_id: user.id, p_file_id: fileId });
    if (error) {
      console.error('toggle_like error:', error);
      return toJson({ error: "Failed to update like" }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;
    const liked = row?.liked ?? false;
    let likedCategories: string[] = [];
    if (liked && db) {
      // A like is a strong taste signal: bump the user's affinity for this
      // file's categories + upload region. Fire-and-forget, never blocks.
      void recordFileTaste(user.id, fileId, 1).catch(() => {});
      const { data: fileRow } = await db.from('files').select('owner_id, categories').eq('id', fileId).maybeSingle();
      if (Array.isArray(fileRow?.categories)) {
        likedCategories = fileRow.categories.filter((c: unknown): c is string => typeof c === 'string');
      }
      if (fileRow?.owner_id) {
        await createNotification({
          userId: fileRow.owner_id,
          type: 'file_like',
          actorId: user.id,
          fileId,
        });
        void enqueuePush(fileRow.owner_id, 'file_like', user.id, fileId);
      }
    } else if (!liked && db) {
      // Unlike within the debounce window cancels the not-yet-sent push.
      const { data: fileRow } = await db.from('files').select('owner_id').eq('id', fileId).maybeSingle();
      if (fileRow?.owner_id) void cancelPush(fileRow.owner_id, 'file_like', user.id, fileId);
    }
    return toJson({
      success: true,
      liked,
      disliked: row?.disliked ?? false,
      like_count: Number(row?.like_count) ?? 0,
      dislike_count: Number(row?.dislike_count) ?? 0,
      // Categories of the liked file so the client can steer the
      // in-session feed (session_cats) without an extra fetch.
      categories: likedCategories
    });
  } catch (error) {
    console.error('Like action error:', error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
