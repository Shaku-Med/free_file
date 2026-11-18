import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { getFileCounts } from "~/lib/studio/fileCounts.server";
import {
  fetchOwnerDailyEvents,
  fetchOwnerFileViews,
} from "~/lib/studio/analyticsDaily.server";

const DAY_MS = 86_400_000;
const RECENT_POSTS = 10;
/** Keeps the per file view query for the comparison to a few pages at most. */
const COMPARE_MAX_AGE_DAYS = 120;
const WATCH_FILE_CAP = 200;
const TOP_RECENT = 3;

const FILE_FIELDS =
  "id, unique_id, filename, file_title, file_type, endpoint, duration, created_at, " +
  "view_count, default_thumbnail, thumbnails, is_adult";

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
  file_type: string;
  endpoint: string;
  duration?: number | null;
  created_at: string;
  view_count?: number | null;
  default_thumbnail?: string | null;
  thumbnails?: string[] | null;
  is_adult?: boolean | null;
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => dayKey(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
const ageDays = (iso: string, now: number) => (now - Date.parse(iso)) / DAY_MS;

/** Enough to draw and link a post. The row id stays on the server. */
function publicPost(r: FileRow) {
  return {
    unique_id: r.unique_id,
    filename: r.filename,
    file_title: r.file_title ?? null,
    file_type: r.file_type,
    endpoint: r.endpoint,
    duration: r.duration ?? null,
    created_at: r.created_at,
    default_thumbnail: r.default_thumbnail ?? null,
    thumbnails: r.thumbnails ?? null,
    // Tells the browser to fetch the thumbnail with the load token.
    is_adult: Boolean(r.is_adult),
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function latestPostSummary(userId: string, recent: FileRow[], now: number) {
  const head = recent[0];
  if (!head) return null;

  const counts = await getFileCounts([head.id]);
  const byViews = [...recent].sort(
    (a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0),
  );
  const rank = byViews.findIndex((r) => r.id === head.id) + 1;

  // Compare the same stretch of each post's life: the first N days, where N
  // is how long the newest post has been up. Peers need a full window.
  const windowDays = Math.min(7, Math.max(1, Math.ceil(ageDays(head.created_at, now))));
  let window: { days: number; views: number; typical: number | null } | null = null;

  if (ageDays(head.created_at, now) <= COMPARE_MAX_AGE_DAYS) {
    const peers = recent.slice(1).filter((r) => {
      const age = ageDays(r.created_at, now);
      return age >= windowDays && age <= COMPARE_MAX_AGE_DAYS;
    });
    const sinceDay = [head, ...peers].map((r) => r.created_at.slice(0, 10)).sort()[0];
    const rows = await fetchOwnerFileViews(userId, sinceDay, [head.id, ...peers.map((p) => p.id)]);

    if (rows) {
      const viewsIn = (r: FileRow) => {
        const start = r.created_at.slice(0, 10);
        const end = addDays(start, windowDays - 1);
        let n = 0;
        for (const v of rows) {
          if (v.file_id === r.id && v.day >= start && v.day <= end) n += v.count;
        }
        return n;
      };
      const peerViews = peers.map(viewsIn);
      window = {
        days: windowDays,
        views: viewsIn(head),
        typical: peerViews.length >= 3 ? Math.round(median(peerViews)) : null,
      };
    }
  }

  return {
    ...publicPost(head),
    view_count: Number(head.view_count) || 0,
    like_count: counts.likes.get(head.id) ?? 0,
    comment_count: counts.comments.get(head.id) ?? 0,
    rank: recent.length > 1 ? rank : null,
    rankOf: recent.length,
    window,
  };
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);
    const userId = user.id;

    const now = Date.now();
    const today = dayKey(now);
    const since28 = new Date(now - 28 * DAY_MS).toISOString();
    const day28 = addDays(today, -27);
    const day56 = addDays(today, -55);
    // Daily buckets, so "last 48 hours" is yesterday and today.
    const day2 = addDays(today, -1);

    const [recentRes, subsRes, newSubsRes, posts28Res, ownerDaily, fileViews28] =
      await Promise.all([
        db
          .from("files")
          .select(FILE_FIELDS)
          .eq("owner_id", userId)
          .order("created_at", { ascending: false })
          .limit(RECENT_POSTS),
        db
          .from("subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("channel_id", userId),
        db
          .from("subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("channel_id", userId)
          .gte("created_at", since28),
        db
          .from("files")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .gte("created_at", since28),
        fetchOwnerDailyEvents(userId, day56),
        fetchOwnerFileViews(userId, day28),
      ]);

    if (recentRes.error || subsRes.error || newSubsRes.error || posts28Res.error) {
      console.error("[studio/dashboard]", {
        recent: recentRes.error,
        subs: subsRes.error,
        newSubs: newSubsRes.error,
        posts28: posts28Res.error,
      });
      return denyErr(500);
    }

    const recent = (recentRes.data ?? []) as unknown as FileRow[];
    const latest = await latestPostSummary(userId, recent, now);

    const analytics = fileViews28 !== null;
    let views28 = 0;
    let viewsPrev28: number | null = null;
    let watchSeconds = 0;
    let topRecent: Array<ReturnType<typeof publicPost> & { views: number }> = [];

    if (fileViews28) {
      let prev = 0;
      for (const ev of ownerDaily) {
        if (ev.event_type !== "video_view") continue;
        const c = Number(ev.count) || 0;
        if (ev.day >= day28) views28 += c;
        else prev += c;
      }
      viewsPrev28 = prev > 0 ? prev : null;

      const perFile = new Map<string, { total: number; recent: number }>();
      for (const v of fileViews28) {
        const e = perFile.get(v.file_id) ?? { total: 0, recent: 0 };
        e.total += v.count;
        if (v.day >= day2) e.recent += v.count;
        perFile.set(v.file_id, e);
      }
      const entries = [...perFile.entries()];
      const topRecentIds = entries
        .filter(([, e]) => e.recent > 0)
        .sort((a, b) => b[1].recent - a[1].recent)
        .slice(0, TOP_RECENT);
      const watchIds = entries
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, WATCH_FILE_CAP);
      const ids = [...new Set([...watchIds, ...topRecentIds].map(([id]) => id))];

      if (ids.length > 0) {
        const filesRes = await db.from("files").select(FILE_FIELDS).eq("owner_id", userId).in("id", ids);
        if (filesRes.error) console.error("[studio/dashboard] files", filesRes.error);
        const byId = new Map(
          ((filesRes.data ?? []) as unknown as FileRow[]).map((r) => [r.id, r]),
        );
        // No watch heartbeats yet, so assume half of each view's duration.
        for (const [id, e] of watchIds) {
          watchSeconds += e.total * (Number(byId.get(id)?.duration) || 0) * 0.5;
        }
        topRecent = topRecentIds.flatMap(([id, e]) => {
          const f = byId.get(id);
          return f ? [{ ...publicPost(f), views: e.recent }] : [];
        });
      }
    } else {
      // Without event analytics the best we have is lifetime views on posts
      // published in the window.
      const { data, error } = await db
        .from("files")
        .select("view_count, duration")
        .eq("owner_id", userId)
        .gte("created_at", since28);
      if (error) console.error("[studio/dashboard] fallback", error);
      for (const r of (data ?? []) as Array<{ view_count?: number; duration?: number }>) {
        const v = Number(r.view_count) || 0;
        views28 += v;
        watchSeconds += v * (Number(r.duration) || 0) * 0.5;
      }
    }

    return toJson({
      success: true,
      analytics,
      latest,
      channel: {
        subscribers: subsRes.count ?? 0,
        newSubscribers28d: newSubsRes.count ?? 0,
        posts28d: posts28Res.count ?? 0,
        views28d: views28,
        viewsPrev28d: viewsPrev28,
        watchHours28d: Math.round(watchSeconds / 360) / 10,
      },
      topRecent,
    });
  } catch (e) {
    console.error("[studio/dashboard] unexpected", e);
    return denyErr(500);
  }
};
