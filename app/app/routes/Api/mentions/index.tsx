import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const MIN_QUERY_LENGTH = 1;
const MAX_LIMIT = 15;

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) {
      return new Response(null, { status: 401 });
    }

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(limitParam ?? "10", 10) || 10));

    if (!db) {
      return new Response(null, { status: 503 });
    }

    if (q.length < MIN_QUERY_LENGTH) {
      return new Response(null, { status: 200 });
    }

    const { data, error } = await db
      .from("users")
      .select("id, username, profile_pic")
      .ilike("username", `${q}%`)
      .eq("is_memories", false)
      .limit(limit);

    if (error) {
      console.error("Mentions API error:", error);
      return toJson({ error: "Search failed", results: [] }, 500);
    }

    const results = (data || []).map((row: { id: string; username: string; profile_pic?: string }) => ({
      id: row.id,
      username: row.username ?? "",
      profile_pic: row.profile_pic ?? "",
    }));

    return toJson({ results }, 200);
  } catch (err) {
    console.error("Mentions API error:", err);
    return toJson({ error: "Internal server error", results: [] }, 500);
  }
};
