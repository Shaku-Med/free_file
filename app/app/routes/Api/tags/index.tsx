import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const MIN_QUERY_LENGTH = 1;
const MAX_LIMIT = 20;

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

    const useQuery = q.length >= MIN_QUERY_LENGTH ? q : null;

    const { data, error } = await db.rpc("get_tag_suggestions", {
      p_query: useQuery,
      p_limit: limit,
    });

    if (error) {
      console.error("get_tag_suggestions error:", error);
      return new Response(null, { status: 500 });
    }

    const results = Array.isArray(data)
      ? data.map((row: { tag_name?: string; usage_count?: number }) => ({
          tag: row?.tag_name ?? "",
          count: Number(row?.usage_count ?? 0),
        }))
      : [];

    return toJson({ results }, 200);
  } catch (err) {
    console.error("Tags API error:", err);
    return new Response(null, { status: 500 });
  }
};
