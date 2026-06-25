/**
 * POST /api/search/recent  remove one of the signed-in user's recent searches
 * (the "x" in the navbar search dropdown). Same browser-only guard as the rest
 * of the search surface (POST + X-Requested-With).
 */

import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json(405, { error: "method" });
  if (request.headers.get("X-Requested-With") !== "fetch") return json(403, { error: "forbidden" });

  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) return json(401, { error: "auth" });

  let body: { query?: unknown };
  try {
    body = (await request.json()) as { query?: unknown };
  } catch {
    return json(400, { error: "bad" });
  }
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";
  if (!query) return json(400, { error: "query" });

  await db.rpc("delete_recent_search", { p_user_id: user.id, p_query: query });
  return json(200, { ok: true });
};

export const loader = () => json(405, { error: "method" });
