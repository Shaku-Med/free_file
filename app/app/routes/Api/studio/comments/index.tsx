import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { validateInteger } from "~/lib/Security/inputValidation";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    const url = new URL(request.url);
    const limit = validateInteger(url.searchParams.get("limit"), 1, 50) ?? 20;
    const offset = validateInteger(url.searchParams.get("offset"), 0, 5000) ?? 0;

    // Join through files.owner_id instead of .in(file_id, [...]) so we do not
    // blow past PostgREST's ~16KB URL/header cap when the owner has many posts.
    const { data: rows, count, error } = await db
      .from("comments")
      .select(
        "id, file_id, content, created_at, updated_at, parent_id, " +
          "user_id, users!user_id(id, username, profile_pic, verified), " +
          "file:files!inner(id, unique_id, file_title, filename, default_thumbnail, thumbnails, file_type, endpoint, created_at)",
        { count: "exact" },
      )
      .eq("files.owner_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[studio/comments]", error);
      return denyErr(500);
    }

    const enriched = (rows ?? []).map((r: unknown) => {
      const row = r as {
        file_id: string;
        content?: string;
        file?: Record<string, unknown> | null;
      } & Record<string, unknown>;
      return { ...row, comment: row.content ?? "", file: row.file ?? null };
    });

    return toJson({
      success: true,
      data: enriched,
      pagination: {
        limit,
        offset,
        total: count ?? 0,
        hasMore: typeof count === "number" ? offset + (rows?.length ?? 0) < count : false,
      },
    });
  } catch (e) {
    console.error("[studio/comments] unexpected", e);
    return denyErr(500);
  }
};
