import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") return denyErr(405);
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    let body: { unique_id?: unknown };
    try {
      body = (await request.json()) as { unique_id?: unknown };
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
      console.error("[studio/post/delete] lookup", lookupErr);
      return denyErr(500);
    }
    if (!existing) return denyErr(404);
    if ((existing as { owner_id: string }).owner_id !== user.id) return denyErr(403);

    const { error: delErr } = await db
      .from("files")
      .delete()
      .eq("id", (existing as { id: string }).id)
      .eq("owner_id", user.id);
    if (delErr) {
      console.error("[studio/post/delete] delete", delErr);
      return denyErr(500);
    }

    return toJson({ success: true });
  } catch (e) {
    console.error("[studio/post/delete] unexpected", e);
    return denyErr(500);
  }
};

export const loader = () => denyErr(405);
