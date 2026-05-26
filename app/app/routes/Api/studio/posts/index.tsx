import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { validateInteger } from "~/lib/Security/inputValidation";
import { getFileCounts } from "~/lib/studio/fileCounts.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

interface PostRow {
  id: string;
  unique_id: string;
  filename: string;
  file_title?: string | null;
  file_type: string;
  endpoint: string;
  duration?: number | null;
  created_at: string;
  view_count?: number | null;
  is_public?: boolean | null;
  is_adult?: boolean | null;
  is_reel?: boolean | null;
  upload_status?: string | null;
  processing_progress?: number | null;
  default_thumbnail?: string | null;
  thumbnails?: string[] | null;
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    const url = new URL(request.url);
    const limit = validateInteger(url.searchParams.get("limit"), 1, 60) ?? 24;
    const offset = validateInteger(url.searchParams.get("offset"), 0, 10000) ?? 0;
    const status = (url.searchParams.get("status") || "all").toLowerCase();
    const sortRaw = (url.searchParams.get("sort") || "newest").toLowerCase();

    const sortField = ((): { column: string; ascending: boolean } => {
      switch (sortRaw) {
        case "views":
          return { column: "view_count", ascending: false };
        case "oldest":
          return { column: "created_at", ascending: true };
        default:
          return { column: "created_at", ascending: false };
      }
    })();

    let q = db
      .from("files")
      .select(
        "id, unique_id, filename, file_title, file_type, endpoint, duration, " +
          "created_at, view_count, is_public, is_adult, is_reel, " +
          "upload_status, processing_progress, default_thumbnail, thumbnails",
        { count: "exact" },
      )
      .eq("owner_id", user.id)
      .order(sortField.column, { ascending: sortField.ascending })
      .range(offset, offset + limit - 1);

    if (status === "public") q = q.eq("is_public", true);
    else if (status === "private") q = q.eq("is_public", false);
    else if (status === "adult") q = q.eq("is_adult", true);
    else if (status === "processing") q = q.neq("upload_status", "complete");

    const { data: rawRows, count, error } = await q;
    if (error) {
      console.error("[studio/posts]", error);
      return denyErr(500);
    }

    const rows = (rawRows ?? []) as PostRow[];
    const counts = await getFileCounts(rows.map((r) => r.id));
    const enriched = rows.map((r) => ({
      ...r,
      like_count: counts.likes.get(r.id) ?? 0,
      comment_count: counts.comments.get(r.id) ?? 0,
    }));

    return toJson({
      success: true,
      data: enriched,
      pagination: {
        limit,
        offset,
        total: count ?? 0,
        hasMore: typeof count === "number" ? offset + rows.length < count : false,
      },
    });
  } catch (e) {
    console.error("[studio/posts] unexpected", e);
    return denyErr(500);
  }
};
