import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id || !db) return jsonRes({ playlist_ids: [] });

  const url = new URL(request.url);
  const fileId = url.searchParams.get("file_id");
  if (!fileId || !UUID_RE.test(fileId)) return jsonRes({ playlist_ids: [] });

  const { data, error } = await db.rpc("get_playlists_containing_file", {
    p_user_id: user.id,
    p_file_id: fileId,
  });

  if (error) {
    console.error("[playlists] get_playlists_containing_file error:", error);
    return jsonRes({ playlist_ids: [] });
  }

  return jsonRes({ playlist_ids: (data || []).map((r: any) => r.playlist_id) });
};
