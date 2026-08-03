import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

/**
 * GET /api/studio/series — the signed-in owner's series, for the Studio series
 * manager. Returns each series' cover title + episode count; episodes are
 * lazy-loaded per series via /api/series-episodes when expanded.
 *
 * Security: every row is scoped to the caller (owner_id = user.id). No request
 * input beyond the session, so there's nothing to inject. Errors are generic so
 * we never leak DB internals (mirrors /api/studio/posts).
 */

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

export const loader = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "GET") return denyErr(405);

    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    const { data: seriesRows, error } = await db
      .from("file_series")
      .select("id, file_id")
      .eq("owner_id", user.id);

    if (error) {
      console.error("[studio/series]", error.message);
      return denyErr(500);
    }

    const rows = Array.isArray(seriesRows) ? seriesRows : [];
    if (rows.length === 0) return toJson({ series: [] }, 200);

    const mainUniqueIds = Array.from(
      new Set(rows.map((s) => (s.file_id ? String(s.file_id) : "")).filter(Boolean)),
    );
    const seriesIds = rows.map((s) => String(s.id));

    // Cover titles/dates for the main files, and episode counts per series.
    // Both queries stay scoped to the caller's own rows.
    const [{ data: mains }, { data: eps }] = await Promise.all([
      mainUniqueIds.length > 0
        ? db
            .from("files")
            .select("unique_id, file_title, filename, default_thumbnail, preview_endpoint, created_at")
            .eq("owner_id", user.id)
            .in("unique_id", mainUniqueIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      db
        .from("files_series_episodes")
        .select("feed_series_id")
        .eq("owner_id", user.id)
        .in("feed_series_id", seriesIds),
    ]);

    const mainByUid = new Map<
      string,
      { title: string; thumbnail: string | null; createdAt: string }
    >();
    for (const m of (mains ?? []) as Array<Record<string, unknown>>) {
      const uid = String(m.unique_id ?? "");
      if (!uid) continue;
      const title =
        (typeof m.file_title === "string" && m.file_title.trim()) ||
        (typeof m.filename === "string" ? m.filename : "") ||
        "Untitled series";
      mainByUid.set(uid, {
        title: String(title),
        thumbnail: typeof m.default_thumbnail === "string" ? m.default_thumbnail : null,
        createdAt: typeof m.created_at === "string" ? m.created_at : "",
      });
    }

    const epCount = new Map<string, number>();
    for (const e of (eps ?? []) as Array<Record<string, unknown>>) {
      const sid = String(e.feed_series_id ?? "");
      if (!sid) continue;
      epCount.set(sid, (epCount.get(sid) ?? 0) + 1);
    }

    const series = rows
      .map((s) => {
        const uid = s.file_id ? String(s.file_id) : "";
        const main = mainByUid.get(uid);
        return {
          fileSeriesId: String(s.id),
          mainUniqueId: uid || null,
          title: main?.title ?? "Untitled series",
          thumbnail: main?.thumbnail ?? null,
          episodeCount: epCount.get(String(s.id)) ?? 0,
          _createdAt: main?.createdAt ?? "",
        };
      })
      // Newest series first, then strip the internal sort key.
      .sort((a, b) => (a._createdAt < b._createdAt ? 1 : a._createdAt > b._createdAt ? -1 : 0))
      .map(({ _createdAt, ...rest }) => rest);

    return toJson({ series }, 200);
  } catch (err) {
    console.error("[studio/series] loader:", err);
    return denyErr(500);
  }
};
