import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

interface UpdateBody {
  unique_id?: unknown;
  file_title?: unknown;
  file_description?: unknown;
  is_public?: unknown;
  tags?: unknown;
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") return denyErr(405);
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    let body: UpdateBody;
    try {
      body = (await request.json()) as UpdateBody;
    } catch {
      return denyErr(400);
    }

    const uniqueId = typeof body.unique_id === "string" ? body.unique_id : "";
    if (!uniqueId || uniqueId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(uniqueId)) {
      return denyErr(400);
    }

    const { data: existing, error: lookupErr } = await db
      .from("files")
      .select("id, owner_id")
      .eq("unique_id", uniqueId)
      .maybeSingle();
    if (lookupErr) {
      console.error("[studio/post/update] lookup", lookupErr);
      return denyErr(500);
    }
    if (!existing) return denyErr(404);
    if ((existing as { owner_id: string }).owner_id !== user.id) return denyErr(403);

    const patch: Record<string, unknown> = {};
    if (typeof body.file_title === "string") {
      const v = body.file_title.trim();
      if (v.length > 200) return denyErr(400);
      patch.file_title = v;
    }
    if (typeof body.file_description === "string") {
      const v = body.file_description;
      if (v.length > 5000) return denyErr(400);
      patch.file_description = v;
    }
    if (typeof body.is_public === "boolean") {
      patch.is_public = body.is_public;
    }
    if (Array.isArray(body.tags)) {
      const tags = body.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 40)
        .slice(0, 30);
      patch.tags = tags;
    }

    if (Object.keys(patch).length === 0) return denyErr(400);

    const { error: updErr } = await db
      .from("files")
      .update(patch)
      .eq("id", (existing as { id: string }).id);
    if (updErr) {
      console.error("[studio/post/update] update", updErr);
      return denyErr(500);
    }

    return toJson({ success: true });
  } catch (e) {
    console.error("[studio/post/update] unexpected", e);
    return denyErr(500);
  }
};

export const loader = () => denyErr(405);
