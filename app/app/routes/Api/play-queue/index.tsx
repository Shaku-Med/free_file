import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import db from "~/lib/Database/supabase";
import { attachIsMusic } from "~/lib/files/attachIsMusic.server";
import { isAuthenticated } from "~/lib/Security/Password";
import { stripGithubRepoForClient } from "~/lib/githubStorage";
import { checkFileAccess } from "~/routes/Dynamic/fun/accessControl";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import {
  collectSeriesMemberIds,
  getSeriesUpNextVideos,
  groupSeriesRpcRows,
  mapSeriesRpcRowToFileType,
} from "~/routes/Dynamic/fun/mapSeriesRpcRows";
import type { FileType, SeriesEpisodeGroup } from "~/lib/types";

const RELATED_LIMIT = 20;
const SUGGESTED_LIMIT = 10;

function parseSessionCats(param: string | null): string[] {
  if (!param) return [];
  try {
    const parsed = JSON.parse(param);
    return Array.isArray(parsed)
      ? parsed.filter((c: unknown) => typeof c === "string").slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function mapRelatedRpcRow(file: Record<string, unknown>) {
  const likeCount = Number(file.like_count) || 0;
  const dislikeCount = Number(file.dislike_count) || 0;
  const commentCount = Number(file.comment_count) || 0;
  return {
    row: {
      id: file.id,
      created_at: file.created_at,
      endpoint: file.endpoint || "",
      filename: file.filename,
      unique_id: file.unique_id,
      file_size: file.file_size,
      file_type: file.file_type,
      is_adult: file.is_adult,
      owner_id: file.owner_id,
      is_public: file.is_public,
      file_description: file.file_description,
      file_title: file.file_title || "",
      default_thumbnail: file.default_thumbnail || null,
      preview_endpoint: file.preview_endpoint || null,
      view_count: file.view_count,
      share_count: file.share_count,
      is_reel: file.is_reel,
      is_series_main: file.is_series_main,
      is_series_episode: file.is_series_episode,
      is_files_series_item: file.is_files_series_item,
      file_series_id: file.file_series_id,
      file_series_episode_id: file.file_series_episode_id,
      feed_reel_cluster_id:
        file.feed_reel_cluster_id != null && file.feed_reel_cluster_id !== ""
          ? Number(file.feed_reel_cluster_id)
          : null,
      duration: file.duration,
      categories: file.categories,
      tags: file.tags,
      colors: file.colors,
      metadata: file.metadata,
      like_count: likeCount,
      dislike_count: dislikeCount,
      comment_count: commentCount,
      engagement_score: Number(file.engagement_score) ?? 0,
      owner: file.owner_username
        ? {
            id: file.owner_id,
            username: file.owner_username,
            profile_pic: file.owner_profile_pic || "",
            verified: file.owner_verified ?? false,
            about: file.owner_about ?? null,
          }
        : null,
    } as FileType,
    liked: Boolean(file.user_has_liked),
    disliked: Boolean(file.user_has_disliked),
  };
}

/**
 * GET /api/play-queue?unique_id=<file unique_id>
 *
 * Returns the default play queue seed (series up-next + suggested related) for a watch page.
 * Fetched once at the app root; sidebar related rail uses its own `/api/related-videos` feed.
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

  const { data: rawFile, error: fileErr } = await db
    .from("files")
    .select("*")
    .eq("unique_id", uniqueId)
    .maybeSingle();

  if (fileErr) {
    console.error("[play-queue] file fetch", fileErr);
    return data({ error: "Failed to load file" }, { status: 500 });
  }

  const file = rawFile
    ? (() => {
        const stripped = stripGithubRepoForClient(rawFile as Record<string, unknown>) as Record<
          string,
          unknown
        >;
        const { thumbnails: _omitThumbnails, ...rest } = stripped;
        return rest as typeof rawFile;
      })()
    : null;

  if (!file) {
    return data(
      {
        currentUniqueId: uniqueId,
        fileId: null,
        seriesUpNext: [] as FileType[],
        suggested: [] as FileType[],
        userActions: { likedFileIds: [] as string[], dislikedFileIds: [] as string[] },
      },
      { status: 404 }
    );
  }

  const accessControl = await checkFileAccess(request, file);
  if (!accessControl.allowed) {
    return data({ error: "Forbidden" }, { status: 403 });
  }

  const user = await isAuthenticated(request, ["id"]);
  const userId: string | undefined = user?.id || undefined;

  let seriesEpisodes: SeriesEpisodeGroup[] | null = null;
  const likedFileIds: string[] = [];
  const dislikedFileIds: string[] = [];

  if (userId && file.file_series_id && file.owner_id) {
    const { data: seriesRows, error: seriesErr } = await db.rpc(
      "get_series_episodes_with_items_for_viewer",
      {
        p_file_series_id: file.file_series_id,
        p_series_owner_id: file.owner_id,
        p_viewer_id: userId,
      }
    );

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
      const filtered = (seriesRows as Record<string, unknown>[]).filter((r) =>
        allowedIds.has(String(r.id))
      );
      const seriesRowsNoAdult = filtered.filter((r) => !Boolean(r.is_adult));
      if (seriesRowsNoAdult.length > 0) {
        seriesEpisodes = groupSeriesRpcRows(seriesRowsNoAdult);
        for (const r of seriesRowsNoAdult) {
          if (r.user_has_liked) likedFileIds.push(String(r.id));
          if (r.user_has_disliked) dislikedFileIds.push(String(r.id));
        }
      }
    }
  }

  const seriesUpNext = getSeriesUpNextVideos(seriesEpisodes, uniqueId);
  const seriesMemberIds = collectSeriesMemberIds(seriesEpisodes);

  const sessionCats = parseSessionCats(url.searchParams.get("session_cats"));
  const rpcParams: Record<string, unknown> = {
    p_file_id: file.id,
    p_user_id: userId || null,
    p_limit: RELATED_LIMIT,
    p_cursor_pos: 0,
    ...(sessionCats.length > 0 ? { p_session_cats: sessionCats } : {}),
  };

  const { data: related, error: relatedErr } = await db.rpc("get_related", rpcParams);
  if (relatedErr) {
    console.error("[play-queue] get_related RPC error:", relatedErr);
  }

  let relatedRows = related || [];
  if (relatedRows.length > 0) {
    relatedRows = await filterFilesByAccess(request, relatedRows);
  }

  const relatedVideos: FileType[] = [];
  for (const row of relatedRows as Record<string, unknown>[]) {
    const mapped = mapRelatedRpcRow(row);
    relatedVideos.push(mapped.row);
    if (mapped.liked) likedFileIds.push(String(row.id));
    if (mapped.disliked) dislikedFileIds.push(String(row.id));
  }

  const suggested = relatedVideos
    .filter((v) => v.unique_id !== uniqueId && !seriesMemberIds.has(v.unique_id))
    .slice(0, SUGGESTED_LIMIT);

  // Queue/end-card cards: get_related has no is_music, so attach it.
  await attachIsMusic(db, suggested);
  if (Array.isArray(seriesUpNext) && seriesUpNext.length > 0) await attachIsMusic(db, seriesUpNext);

  return data(
    {
      currentUniqueId: uniqueId,
      fileId: String(file.id),
      seriesUpNext,
      suggested,
      userActions: { likedFileIds, dislikedFileIds },
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
};
