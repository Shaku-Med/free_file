import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId } from "~/lib/Security/inputValidation";

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
    const body = await request.json();
    const fileId = body?.fileId;
    if (!fileId || !isValidFileId(fileId)) return toJson({ error: "Invalid fileId" }, 400);
    const { data, error } = await db.rpc('toggle_like', { p_user_id: user.id, p_file_id: fileId });
    if (error) {
      console.error('toggle_like error:', error);
      return toJson({ error: "Failed to update like" }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;
    return toJson({
      success: true,
      liked: row?.liked ?? false,
      disliked: row?.disliked ?? false,
      like_count: row?.like_count ?? 0,
      dislike_count: row?.dislike_count ?? 0
    });
  } catch (error) {
    console.error('Like action error:', error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
