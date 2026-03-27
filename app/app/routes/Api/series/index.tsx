import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";

const MAX_TITLE = 100;
const MAX_DESC  = 1000;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function strip(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

/** GET /api/series — list the authenticated user's series */
export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) return jsonRes({ error: "Unauthorized" }, 401);
  if (!db)       return jsonRes({ error: "Something went wrong" }, 503);

  const { data, error } = await db.rpc("get_user_series", { p_user_id: user.id });

  if (error) {
    console.error("[series] get_user_series:", error);
    return jsonRes({ error: "Something went wrong" }, 500);
  }

  return jsonRes({ series: data ?? [] });
};

/** POST /api/series — create a new series */
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return jsonRes({ error: "Method not allowed" }, 405);

  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) return jsonRes({ error: "Unauthorized" }, 401);
  if (!db)       return jsonRes({ error: "Something went wrong" }, 503);

  let body: { title?: string; description?: string; is_public?: boolean };
  try { body = await request.json(); }
  catch { return jsonRes({ error: "Invalid JSON" }, 400); }

  if (typeof body.title !== "string") return jsonRes({ error: "Title is required" }, 400);

  const title = strip(body.title).trim();
  if (!title)               return jsonRes({ error: "Title is required" }, 400);
  if (title.length > MAX_TITLE) return jsonRes({ error: "Title too long (max 100)" }, 400);

  const rawDesc = body.description != null ? strip(String(body.description)).trim() : null;
  if (rawDesc && rawDesc.length > MAX_DESC)
    return jsonRes({ error: "Description too long (max 1000)" }, 400);

  const isPublic = typeof body.is_public === "boolean" ? body.is_public : true;

  const { data, error } = await db.rpc("create_series", {
    p_user_id:  user.id,
    p_title:    title,
    p_desc:     rawDesc ?? null,
    p_is_public: isPublic,
  });

  if (error) {
    console.error("[series] create_series:", error);
    if (error.message?.includes("Maximum series limit"))
      return jsonRes({ error: "Maximum series limit reached (50)" }, 429);
    return jsonRes({ error: "Something went wrong" }, 500);
  }

  const series = Array.isArray(data) ? data[0] : data;
  return jsonRes({ series }, 201);
};
