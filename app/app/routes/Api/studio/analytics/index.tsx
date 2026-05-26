import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { validateInteger } from "~/lib/Security/inputValidation";
import { getFileCounts } from "~/lib/studio/fileCounts.server";
import { fetchOwnerDailyEvents } from "~/lib/studio/analyticsDaily.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

interface FileRow {
  id: string;
  unique_id: string;
  filename: string;
  file_title?: string | null;
  view_count?: number | null;
  duration?: number | null;
  created_at: string;
  default_thumbnail?: string | null;
  thumbnails?: string[] | null;
  file_type: string;
  endpoint: string;
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    const url = new URL(request.url);
    const days = validateInteger(url.searchParams.get("days"), 7, 90) ?? 28;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [topByViews, recentUploads, allOwned, subsCount, eventRows] = await Promise.all([
      db
        .from("files")
        .select(
          "id, unique_id, file_title, filename, view_count, duration, created_at, " +
            "default_thumbnail, thumbnails, file_type, endpoint",
        )
        .eq("owner_id", user.id)
        .order("view_count", { ascending: false })
        .limit(10),
      db
        .from("files")
        .select("id, view_count, duration, created_at")
        .eq("owner_id", user.id)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true }),
      db
        .from("files")
        .select("id, view_count, duration")
        .eq("owner_id", user.id),
      db
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", user.id),
      fetchOwnerDailyEvents(user.id, cutoff.slice(0, 10)),
    ]);

    if (topByViews.error || recentUploads.error || allOwned.error || subsCount.error) {
      console.error("[studio/analytics]", {
        top: topByViews.error,
        recent: recentUploads.error,
        all: allOwned.error,
        subs: subsCount.error,
      });
      return denyErr(500);
    }

    const topRows = (topByViews.data ?? []) as FileRow[];
    const recentRows = (recentUploads.data ?? []) as Array<{
      id: string;
      view_count?: number;
      duration?: number;
      created_at?: string;
    }>;
    const allRows = (allOwned.data ?? []) as Array<{
      id: string;
      view_count?: number;
      duration?: number;
    }>;

    const allIds = allRows.map((r) => r.id);
    const counts = await getFileCounts(allIds);

    const buckets = new Map<string, { uploads: number; views: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { uploads: 0, views: 0 });
    }
    for (const r of recentRows) {
      const key = (r.created_at ?? "").slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.uploads += 1;
    }
    const eventRowsList = eventRows;
    for (const ev of eventRowsList) {
      if (ev.event_type !== "video_view") continue;
      const bucket = buckets.get(ev.day);
      if (!bucket) continue;
      bucket.views += Number(ev.count) || 0;
    }
    const timeline = Array.from(buckets.entries()).map(([date, b]) => ({ date, ...b }));

    let totalViews = 0;
    let totalWatchHours = 0;
    for (const r of allRows) {
      const v = Number(r.view_count) || 0;
      const dur = Number(r.duration) || 0;
      totalViews += v;
      totalWatchHours += (v * dur * 0.5) / 3600;
    }

    const topWithCounts = topRows.map((p) => ({
      ...p,
      like_count: counts.likes.get(p.id) ?? 0,
      comment_count: counts.comments.get(p.id) ?? 0,
    }));

    return toJson({
      success: true,
      window: { days },
      totals: {
        views: totalViews,
        likes: counts.totalLikes,
        comments: counts.totalComments,
        estWatchHours: Math.round(totalWatchHours * 10) / 10,
        subscribers: subsCount.count ?? 0,
      },
      timeline,
      topPosts: topWithCounts,
    });
  } catch (e) {
    console.error("[studio/analytics] unexpected", e);
    return denyErr(500);
  }
};
