import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=120" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Trending tags across the platform in the last 7 days (no per user
    // gating needed here, this is platform wide discovery data). We still
    // require a logged in session so the page is not anonymously scrapable.
    const [trending, myTopTags] = await Promise.all([
      db
        .from("files")
        .select("tags, view_count")
        .eq("is_public", true)
        .gte("created_at", since7d)
        .order("view_count", { ascending: false })
        .limit(200),
      db
        .from("files")
        .select("tags, view_count")
        .eq("owner_id", user.id)
        .order("view_count", { ascending: false })
        .limit(50),
    ]);

    if (trending.error || myTopTags.error) {
      console.error("[studio/inspiration]", { trending: trending.error, mine: myTopTags.error });
      return denyErr(500);
    }

    const score = (rows: { tags?: string[] | null; view_count?: number | null }[]) => {
      const counts = new Map<string, { count: number; views: number }>();
      for (const row of rows ?? []) {
        const tags = Array.isArray(row.tags) ? row.tags : [];
        const v = Number(row.view_count) || 0;
        for (const raw of tags) {
          const tag = String(raw || "").trim().toLowerCase();
          if (!tag) continue;
          const prev = counts.get(tag) ?? { count: 0, views: 0 };
          prev.count += 1;
          prev.views += v;
          counts.set(tag, prev);
        }
      }
      return Array.from(counts.entries())
        .map(([tag, v]) => ({ tag, count: v.count, views: v.views }))
        .sort((a, b) => b.views - a.views || b.count - a.count)
        .slice(0, 30);
    };

    return toJson({
      success: true,
      trending: score((trending.data ?? []) as { tags?: string[] | null; view_count?: number | null }[]),
      yours: score((myTopTags.data ?? []) as { tags?: string[] | null; view_count?: number | null }[]),
    });
  } catch (e) {
    console.error("[studio/inspiration] unexpected", e);
    return denyErr(500);
  }
};
