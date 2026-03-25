import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE = 100;
const MAX_DESC = 500;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stripTags(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) return jsonRes({ error: "Unauthorized" }, 401);
  if (!db) return jsonRes({ error: "Something went wrong" }, 503);

  const { data, error } = await db.rpc("get_user_playlists", { p_user_id: user.id });

  if (error) {
    console.error("[playlists] get_user_playlists error:", error);
    return jsonRes({ error: "Something went wrong" }, 500);
  }

  return jsonRes({ playlists: data || [] });
};

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return jsonRes({ error: "Method not allowed" }, 405);

  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) return jsonRes({ error: "Unauthorized" }, 401);
  if (!db) return jsonRes({ error: "Something went wrong" }, 503);

  let body: { title?: string; description?: string; is_public?: boolean };
  try {
    body = await request.json();
  } catch {
    return jsonRes({ error: "Invalid request" }, 400);
  }

  if (typeof body.title !== "string") return jsonRes({ error: "Invalid request" }, 400);

  const title = stripTags(body.title).trim();
  if (!title || title.length > MAX_TITLE) {
    return jsonRes({ error: title ? "Title too long" : "Title is required" }, 400);
  }

  const description = body.description != null ? stripTags(String(body.description)).trim() : null;
  if (description && description.length > MAX_DESC) {
    return jsonRes({ error: "Description too long" }, 400);
  }

  const isPublic = typeof body.is_public === "boolean" ? body.is_public : true;

  const { data, error } = await db.rpc("create_playlist", {
    p_user_id: user.id,
    p_title: title,
    p_desc: description || null,
    p_is_public: isPublic,
  });

  if (error) {
    console.error("[playlists] create_playlist error:", error);
    if (error.message?.includes("Maximum playlist limit")) {
      return jsonRes({ error: "Maximum playlist limit reached" }, 429);
    }
    return jsonRes({ error: "Something went wrong" }, 500);
  }

  const playlist = Array.isArray(data) ? data[0] : data;
  return jsonRes({ playlist }, 201);
};
