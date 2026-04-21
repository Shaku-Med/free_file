import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { stripGithubRepoForClient } from "~/lib/githubStorage";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import {
  groupSeriesRpcRows,
  mapSeriesRpcRowToFileType,
} from "~/routes/Dynamic/fun/mapSeriesRpcRows";
import type { SeriesEpisodeGroup } from "~/lib/types";

/**
 * GET /api/dynamic-series?unique_id=<file unique_id>
 * Returns series episode tree for the file’s series (same access rules as the dynamic page).
 * Used after the page loads so the HTML document stays small.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  if (!db) {
    return data({ error: "Database not initialized" }, { status: 500 });
  }

  const url = new URL(request.url);
  const uniqueId = url.searchParams.get("unique_id")?.trim() ?? "";
  if (!uniqueId) {
    return data({ error: "unique_id is required" }, { status: 400 });
  }

  const { data: rawFile, error } = await db
    .from("files")
    .select("*")
    .eq("unique_id", uniqueId)
    .maybeSingle();

  if (error) {
    console.error("[dynamic-series] file fetch", error);
    return data({ error: "Failed to load file" }, { status: 500 });
  }

  const file = rawFile
    ? (() => {
        const stripped = stripGithubRepoForClient(rawFile as Record<string, unknown>) as Record<string, unknown>;
        const { thumbnails: _omitThumbnails, ...rest } = stripped;
        return rest as typeof rawFile;
      })()
    : null;

  if (!file) {
    return data(
      {
        seriesEpisodes: null as SeriesEpisodeGroup[] | null,
        seriesContext: null as { fileSeriesId: string } | null,
        seriesVideosUserActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
      },
      { status: 200 }
    );
  }

  const accessControl = await checkFileAccess(request, file);
  if (!accessControl.allowed) {
    return data({ error: "Forbidden" }, { status: 403 });
  }

  const user = await isAuthenticated(request, ["id"]);
  const userId = user?.id ?? null;

  let seriesEpisodes: SeriesEpisodeGroup[] | null = null;
  let seriesContext: { fileSeriesId: string } | null = null;
  const seriesVideosUserActions = { likedFileIds: [] as string[], dislikedFileIds: [] as string[] };

  if (file.file_series_id && file.owner_id) {
    const { data: seriesRows, error: seriesErr } = await db.rpc("get_series_episodes_with_items_for_viewer", {
      p_file_series_id: file.file_series_id,
      p_series_owner_id: file.owner_id,
      p_viewer_id: userId,
    });

    if (!seriesErr && Array.isArray(seriesRows) && seriesRows.length > 0) {
      const forAccess = (seriesRows as Record<string, unknown>[]).map((r) => {
        const base = mapSeriesRpcRowToFileType(r);
        return {
          ...base,
          is_adult: Boolean(r.is_adult),
          is_public: r.is_public !== false,
          owner_id: String(r.owner_id ?? base.owner_id ?? ""),
          upload_status: typeof r.upload_status === "string" ? r.upload_status : undefined,
        };
      });
      const allowed = await filterFilesByAccess(request, forAccess);
      const allowedIds = new Set(allowed.map((f) => f.id).filter(Boolean));
      const filtered = (seriesRows as Record<string, unknown>[]).filter((r) => allowedIds.has(String(r.id)));
      const seriesRowsNoAdult = filtered.filter((r) => !Boolean(r.is_adult));
      if (seriesRowsNoAdult.length > 0) {
        seriesEpisodes = groupSeriesRpcRows(seriesRowsNoAdult);
        seriesContext = { fileSeriesId: String(file.file_series_id) };
        for (const r of seriesRowsNoAdult) {
          if (r.user_has_liked) seriesVideosUserActions.likedFileIds.push(String(r.id));
          if (r.user_has_disliked) seriesVideosUserActions.dislikedFileIds.push(String(r.id));
        }
      }
    }
  }

  return data(
    {
      seriesEpisodes,
      seriesContext,
      seriesVideosUserActions,
    },
    { status: 200 }
  );
};
