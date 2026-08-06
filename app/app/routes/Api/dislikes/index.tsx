import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId } from "~/lib/Security/inputValidation";
import { checkInteractionRateLimit } from "~/routes/Api/fun/personalizationRateLimit";
import { parsePlaybackPosition, recordActionPosition } from "~/lib/Services/actionPosition.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ['id']);
    if (!user?.id) return toJson({}, 401);
    if (!db) return toJson({}, 500);
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');
    if (!fileId) return toJson({}, 400);
    const { data } = await db.from('dislike').select('id').eq('user_id', user.id).eq('file_id', fileId).maybeSingle();
    return toJson({ disliked: !!data }, 200);
  } catch {
    return toJson({}, 500);
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
    const { data, error } = await db.rpc('toggle_dislike', { p_user_id: user.id, p_file_id: fileId });
    if (error) {
      console.error('toggle_dislike error:', error);
      return toJson({ error: "Failed to update dislike" }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;
    const disliked = row?.disliked ?? false;
    void recordActionPosition(user.id, fileId, 'dislike', parsePlaybackPosition(body?.position), disliked);
    // A like and a dislike are mutually exclusive, so toggling one clears the
    // other's position row as well.
    if (disliked) void recordActionPosition(user.id, fileId, 'like', null, false);
    return toJson({
      success: true,
      liked: row?.liked ?? false,
      disliked,
      like_count: row?.like_count ?? 0,
      dislike_count: row?.dislike_count ?? 0
    });
  } catch (error) {
    console.error('Dislike action error:', error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
