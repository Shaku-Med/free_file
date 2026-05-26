import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { validateInteger } from "~/lib/Security/inputValidation";
import { getFileCounts } from "~/lib/studio/fileCounts.server";
import { fetchFileDailyEvents } from "~/lib/studio/analyticsDaily.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

// GET /api/studio/post?unique_id=<uniqueId>&days=7 — owner only.
export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    const url = new URL(request.url);
    const uniqueId = (url.searchParams.get("unique_id") || "").trim();
    if (!uniqueId || uniqueId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(uniqueId)) {
      return denyErr(400);
    }
    const days = validateInteger(url.searchParams.get("days"), 7, 90) ?? 7;

    const { data: fileRow, error: fileErr } = await db
      .from("files")
      .select(
        "id, unique_id, filename, file_title, file_description, file_type, endpoint, " +
          "duration, created_at, view_count, is_public, is_adult, is_reel, " +
          "default_thumbnail, thumbnails, owner_id",
      )
      .eq("unique_id", uniqueId)
      .maybeSingle();

    if (fileErr) {
      console.error("[studio/post] file lookup", fileErr);
      return denyErr(500);
    }
    if (!fileRow) return denyErr(404);

    if ((fileRow as { owner_id?: string }).owner_id !== user.id) return denyErr(403);

    const fileId = (fileRow as { id: string }).id;
    const createdAt = new Date(
      (fileRow as { created_at?: string }).created_at ?? Date.now(),
    );
    const startKey = createdAt.toISOString().slice(0, 10);
    const [counts, perDayRows] = await Promise.all([
      getFileCounts([fileId]),
      fetchFileDailyEvents(fileId, startKey),
    ]);
    const dayKeys: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(createdAt.getTime() + i * 24 * 60 * 60 * 1000);
      dayKeys.push(d.toISOString().slice(0, 10));
    }

    const v = Number((fileRow as { view_count?: number }).view_count) || 0;
    const dur = Number((fileRow as { duration?: number }).duration) || 0;
    const totalPlayTimeSec = Math.round(v * dur * 0.5);
    const avgWatchSec = v > 0 ? totalPlayTimeSec / v : 0;
    const watchedFullPct = dur > 0 && v > 0 ? Math.min(100, Math.round((avgWatchSec / dur) * 100)) : 0;

    const perDayMap = new Map<string, number>();
    for (const ev of perDayRows) {
      if (ev.event_type !== "video_view") continue;
      perDayMap.set(ev.day, Number(ev.count) || 0);
    }
    const timeline = dayKeys.map((date) => ({
      date,
      views: perDayMap.get(date) ?? 0,
    }));

    return toJson({
      success: true,
      file: {
        id: fileId,
        unique_id: (fileRow as { unique_id: string }).unique_id,
        filename: (fileRow as { filename: string }).filename,
        file_title: (fileRow as { file_title?: string | null }).file_title ?? null,
        file_description:
          (fileRow as { file_description?: string | null }).file_description ?? null,
        file_type: (fileRow as { file_type: string }).file_type,
        endpoint: (fileRow as { endpoint: string }).endpoint,
        duration: dur,
        created_at: (fileRow as { created_at: string }).created_at,
        is_public: Boolean((fileRow as { is_public?: boolean }).is_public),
        is_adult: Boolean((fileRow as { is_adult?: boolean }).is_adult),
        is_reel: Boolean((fileRow as { is_reel?: boolean }).is_reel),
        default_thumbnail:
          (fileRow as { default_thumbnail?: string | null }).default_thumbnail ?? null,
        thumbnails: (fileRow as { thumbnails?: string[] | null }).thumbnails ?? null,
      },
      kpis: {
        views: v,
        likes: counts.likes.get(fileId) ?? 0,
        comments: counts.comments.get(fileId) ?? 0,
        totalPlayTimeSec,
        avgWatchSec: Math.round(avgWatchSec * 100) / 100,
        watchedFullPct,
      },
      window: { days, startDate: startKey },
      timeline,
    });
  } catch (e) {
    console.error("[studio/post] unexpected", e);
    return denyErr(500);
  }
};
