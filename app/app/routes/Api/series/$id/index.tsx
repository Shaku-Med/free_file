import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function strip(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

/** GET /api/series/:id — fetch series header + episodes (public-friendly) */
export const loader = async ({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!db) return jsonRes({ error: "Something went wrong" }, 503);

  const { id } = params;
  if (!id) return jsonRes({ error: "Series id required" }, 400);

  const { data, error } = await db.rpc("get_series_by_id", {
    p_unique_id: id,
    p_viewer_id: user?.id ?? null,
  });

  if (error) {
    console.error("[series/:id GET] get_series_by_id:", error);
    return jsonRes({ error: "Something went wrong" }, 500);
  }

  if (!data || (data as unknown[]).length === 0) {
    return jsonRes({ error: "Not found" }, 404);
  }

  const rows = data as Record<string, unknown>[];
  const first = rows[0];

  const series = {
    id:           first.series_id,
    unique_id:    first.series_unique_id,
    owner_id:     first.series_owner_id,
    title:        first.series_title,
    description:  first.series_desc,
    thumbnail_url: first.series_thumb,
    is_public:    first.series_is_public,
    created_at:   first.series_created,
  };

  const episodes = rows
    .filter((r) => r.file_id != null)
    .map((r) => ({
      id:               r.file_id,
      unique_id:        r.file_unique_id,
      file_title:       r.file_title,
      file_description: r.file_description,
      file_type:        r.file_type,
      default_thumbnail: r.default_thumbnail,
      endpoint:         r.endpoint,
      duration:         r.duration,
      view_count:       r.view_count,
      episode_number:   r.episode_number,
      season_number:    r.season_number,
      is_public:        r.file_is_public,
      created_at:       r.file_created_at,
      owner_id:         r.file_owner_id,
      owner: {
        username:    r.owner_username,
        profile_pic: r.owner_avatar_url,
      },
    }));

  return jsonRes({ series, episodes });
};

/** PATCH /api/series/:id or DELETE /api/series/:id */
export const action = async ({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) return jsonRes({ error: "Unauthorized" }, 401);
  if (!db)       return jsonRes({ error: "Something went wrong" }, 503);

  const { id } = params;
  if (!id) return jsonRes({ error: "Series id required" }, 400);

  // Resolve unique_id → uuid + ownership check
  const { data: row, error: lookupErr } = await db
    .from("series")
    .select("id, owner_id")
    .eq("unique_id", id)
    .maybeSingle();

  if (lookupErr || !row) return jsonRes({ error: "Not found" }, 404);
  if (row.owner_id !== user.id) return jsonRes({ error: "Forbidden" }, 403);

  // ── DELETE ──────────────────────────────────────────────────
  if (request.method === "DELETE") {
    const { error } = await db.rpc("delete_series", {
      p_series_id: row.id,
      p_user_id:   user.id,
    });
    if (error) {
      console.error("[series/:id DELETE]:", error);
      return jsonRes({ error: "Something went wrong" }, 500);
    }
    return jsonRes({ success: true });
  }

  // ── PATCH ───────────────────────────────────────────────────
  if (request.method === "PATCH") {
    let body: { title?: string; description?: string | null; is_public?: boolean };
    try { body = await request.json(); }
    catch { return jsonRes({ error: "Invalid JSON" }, 400); }

    const title = body.title != null ? strip(String(body.title)).trim() : null;
    if (title !== null && title.length > 100)
      return jsonRes({ error: "Title too long (max 100)" }, 400);

    // null means "clear description"; undefined means "leave unchanged"
    const clearDesc = body.description === null;
    const desc =
      !clearDesc && body.description != null
        ? strip(String(body.description)).trim()
        : null;
    if (desc && desc.length > 1000)
      return jsonRes({ error: "Description too long (max 1000)" }, 400);

    const { data, error } = await db.rpc("update_series", {
      p_series_id:    row.id,
      p_user_id:      user.id,
      p_title:        title,
      p_desc:         desc,
      p_clear_desc:   clearDesc,
      p_is_public:    typeof body.is_public === "boolean" ? body.is_public : null,
      p_thumbnail_url: null,
    });

    if (error) {
      console.error("[series/:id PATCH]:", error);
      return jsonRes({ error: "Something went wrong" }, 500);
    }

    const series = Array.isArray(data) ? data[0] : data;
    return jsonRes({ success: true, series });
  }

  return jsonRes({ error: "Method not allowed" }, 405);
};
