import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { validateInteger } from "~/lib/Security/inputValidation";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

function parseExclude(raw: string | null): string[] {
  if (!raw) return [];
  let arr: unknown = raw;
  try {
    arr = JSON.parse(raw);
  } catch {
    arr = raw.split(",");
  }
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const v of arr) {
    const s = typeof v === "string" ? v.trim() : "";
    if (UUID_RE.test(s)) out.push(s);
    if (out.length >= 100) break;
  }
  return out;
}

// GET /api/suggested-creators?limit=12&exclude=[...]
// "People you may know" — friend-of-friend creators, topped up with popular.
export const loader = async ({ request }: { request: Request }) => {
  try {
    if (!db) return json({ data: [] });

    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    const userId = user && typeof user !== "boolean" ? user.id : null;

    const url = new URL(request.url);
    const limit = validateInteger(url.searchParams.get("limit"), 1, 30) ?? 12;
    const exclude = parseExclude(url.searchParams.get("exclude"));

    const { data, error } = await db.rpc("get_suggested_creators", {
      p_user_id: userId,
      p_limit: limit,
      p_exclude_ids: exclude,
    });
    if (error) {
      console.error("[suggested-creators] rpc:", error.message ?? error);
      return json({ data: [] });
    }

    const creators = (Array.isArray(data) ? data : []).map((c: any) => ({
      id: String(c.id),
      username: c.username,
      profile_pic: c.profile_pic || "",
      verified: Boolean(c.verified),
      about: typeof c.about === "string" ? c.about : null,
      subscriber_count: Number(c.subscriber_count) || 0,
      mutual_count: Number(c.mutual_count) || 0,
      reason: c.reason === "mutual" ? "mutual" : "popular",
    }));

    return json({ data: creators });
  } catch (e) {
    console.error("[suggested-creators] unexpected:", e);
    return json({ data: [] });
  }
};
