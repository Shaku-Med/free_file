import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId } from "~/lib/Security/inputValidation";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");
    if (!fileId || !isValidFileId(fileId)) return toJson({ error: "Invalid fileId" }, 400);
    const user = await isAuthenticated(request, ["id"]);
    const userId = user?.id ?? null;
    const { data, error } = await db.rpc("get_file_interactions", { p_file_id: fileId, p_user_id: userId });
    if (error) {
      console.error("get_file_interactions error:", error);
      return toJson({ error: "Failed to fetch interactions" }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;
    return toJson({
      like_count: row?.like_count ?? 0,
      dislike_count: row?.dislike_count ?? 0,
      comment_count: row?.comment_count ?? 0,
      user_has_liked: row?.user_has_liked ?? false,
      user_has_disliked: row?.user_has_disliked ?? false,
    });
  } catch (err) {
    console.error("Interactions loader error:", err);
    return toJson({ error: "Internal server error" }, 500);
  }
};
