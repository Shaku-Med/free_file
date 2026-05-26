import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { getFileCounts } from "~/lib/studio/fileCounts.server";

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

    const userId = user.id;
    const since28d = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

    const [postsAgg, recentFiles, subsCount] = await Promise.all([
      db
        .from("files")
        .select("id, view_count, duration", { count: "exact" })
        .eq("owner_id", userId),
      db
        .from("files")
        .select("id, view_count, duration")
        .eq("owner_id", userId)
        .gte("created_at", since28d),
      db
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", userId),
    ]);

    if (postsAgg.error || recentFiles.error || subsCount.error) {
      console.error("[studio/overview]", {
        posts: postsAgg.error,
        recent: recentFiles.error,
        subs: subsCount.error,
      });
      return denyErr(500);
    }

    const allOwnedRows = (postsAgg.data ?? []) as Array<{
      id: string;
      view_count?: number;
      duration?: number;
    }>;
    const recentRows = (recentFiles.data ?? []) as Array<{
      id: string;
      view_count?: number;
      duration?: number;
    }>;

    const allIds = allOwnedRows.map((r) => r.id);
    const counts = await getFileCounts(allIds);

    let totalViews = 0;
    for (const r of allOwnedRows) totalViews += Number(r.view_count) || 0;

    let recentViews = 0;
    let recentWatchHours = 0;
    for (const r of recentRows) {
      const v = Number(r.view_count) || 0;
      const dur = Number(r.duration) || 0;
      recentViews += v;
      // Average watch is unknown without heartbeat aggregation; assume half of duration.
      recentWatchHours += (v * dur * 0.5) / 3600;
    }

    return toJson({
      success: true,
      totals: {
        posts: postsAgg.count ?? 0,
        views: totalViews,
        likes: counts.totalLikes,
        comments: counts.totalComments,
        subscribers: subsCount.count ?? 0,
      },
      last28d: {
        views: recentViews,
        watchHours: Math.round(recentWatchHours * 10) / 10,
      },
    });
  } catch (e) {
    console.error("[studio/overview] unexpected", e);
    return denyErr(500);
  }
};
