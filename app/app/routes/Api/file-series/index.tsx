import { data } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId, isValidUUID, sanitizeString } from "~/lib/Security/inputValidation";

/**
 * Endpoint: /api/file-series
 *
 * GET   returns the current series state for a single file the caller owns.
 *        Query: ?fileId=<uuid|unique_id>
 *        Response: { success, state: { is_series_main, is_files_series_item,
 *                    file_series_id, file_series_episode_id,
 *                    series_title, episode_name } }
 *
 * POST  assigns the file to a series (new or existing), or removes it.
 *        Body: { action: "assign" | "unassign", fileId, ...fields }
 *
 * Security
 *  - Always resolves caller via isAuthenticated().
 *  - Always re-loads the target file row and rejects if owner_id !== user.id.
 *  - Always re-loads any referenced series / episode and rejects if the caller
 *    is not the owner of that row, regardless of client-supplied flags.
 *  - All UUIDs validated; all free-text inputs length-capped + sanitized.
 *  - Never returns PII beyond the caller's own rows.
 */

const toJson = (body: unknown, status = 200) => data(body, { status });

const EPISODE_NAME_MAX = 500;

type FileRow = {
  id: string;
  unique_id: string;
  owner_id: string;
  file_type: string | null;
  is_series_main: boolean | null;
  is_files_series_item: boolean | null;
  file_series_id: string | null;
  file_series_episode_id: string | null;
};

/**
 * Next ordering slot for a new episode in a series: max(episode_number) + 1, so
 * fresh episodes append at the END instead of being interleaved by upload time.
 * Owners reorder later via the "reorder" action (the viewer RPC already sorts by
 * episode_number).
 */
async function nextEpisodeNumber(fileSeriesId: string, userId: string): Promise<number> {
  if (!db) return 1;
  const { data: top } = await db
    .from("files_series_episodes")
    .select("episode_number")
    .eq("feed_series_id", fileSeriesId)
    .eq("owner_id", userId)
    .order("episode_number", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const cur = Number((top as { episode_number?: unknown } | null)?.episode_number);
  return Number.isFinite(cur) && cur > 0 ? Math.floor(cur) + 1 : 1;
}

/** Next slot for a new FILE within an episode (max(position) + 1). */
async function nextItemPosition(episodeId: string, userId: string): Promise<number> {
  if (!db) return 1;
  const { data: top } = await db
    .from("files_series_episode_items")
    .select("position")
    .eq("file_episode_id", episodeId)
    .eq("owner_id", userId)
    .order("position", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const cur = Number((top as { position?: unknown } | null)?.position);
  return Number.isFinite(cur) && cur > 0 ? Math.floor(cur) + 1 : 1;
}

/**
 * Best-effort: stamp an ordering slot on a freshly-added item. Kept SEPARATE
 * from the insert so adding a file NEVER fails just because the `position`
 * column migration hasn't run yet — it silently no-ops, and the viewer RPC
 * falls back to upload order until the column exists.
 */
async function applyItemPosition(
  fileSeriesId: string,
  episodeId: string,
  fileUniqueId: string,
  userId: string,
): Promise<void> {
  if (!db) return;
  try {
    const pos = await nextItemPosition(episodeId, userId);
    await db
      .from("files_series_episode_items")
      .update({ position: pos })
      .eq("file_series_id", fileSeriesId)
      .eq("file_episode_id", episodeId)
      .eq("file_id", fileUniqueId)
      .eq("owner_id", userId);
  } catch {
    /* position column not migrated yet — ordering falls back to upload time */
  }
}

async function loadOwnedFile(fileId: string, userId: string): Promise<FileRow | null> {
  if (!db) return null;
  const lookupField = isValidUUID(fileId) ? "id" : "unique_id";
  const { data: row, error } = await db
    .from("files")
    .select(
      "id, unique_id, owner_id, file_type, is_series_main, is_files_series_item, file_series_id, file_series_episode_id"
    )
    .eq(lookupField, fileId)
    .maybeSingle();
  if (error || !row) return null;
  if (row.owner_id !== userId) return null;
  return row as unknown as FileRow;
}

function currentSeriesStatePayload(row: FileRow, extra: {
  series_title?: string | null;
  episode_name?: string | null;
}) {
  return {
    is_series_main: Boolean(row.is_series_main),
    is_files_series_item: Boolean(row.is_files_series_item),
    file_series_id: row.file_series_id,
    file_series_episode_id: row.file_series_episode_id,
    series_title: extra.series_title ?? null,
    episode_name: extra.episode_name ?? null,
  };
}

/** Load friendly labels (series title + episode name) for display. */
async function loadSeriesLabels(row: FileRow): Promise<{
  series_title: string | null;
  episode_name: string | null;
}> {
  if (!db || (!row.file_series_id && !row.file_series_episode_id)) {
    return { series_title: null, episode_name: null };
  }

  let series_title: string | null = null;
  let episode_name: string | null = null;

  if (row.file_series_id) {
    // Title of the series' main file
    const { data: mainRow } = await db
      .from("files")
      .select("file_title")
      .eq("file_series_id", row.file_series_id)
      .eq("is_series_main", true)
      .maybeSingle();
    if (mainRow && typeof mainRow.file_title === "string") {
      series_title = mainRow.file_title;
    }
  }

  if (row.file_series_episode_id) {
    const { data: epRow } = await db
      .from("files_series_episodes")
      .select("episode_name")
      .eq("id", row.file_series_episode_id)
      .maybeSingle();
    if (epRow && typeof epRow.episode_name === "string") {
      episode_name = epRow.episode_name;
    }
  }

  return { series_title, episode_name };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET") {
    return toJson({ error: "Method not allowed" }, 405);
  }

  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) return toJson({ error: "Unauthorized" }, 401);
  if (!db) return toJson({ error: "Database not initialized" }, 500);

  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId")?.trim() ?? "";
  if (!fileId || !isValidFileId(fileId)) {
    return toJson({ error: "Invalid fileId" }, 400);
  }

  const row = await loadOwnedFile(fileId, user.id);
  if (!row) return toJson({ error: "Not found" }, 404);

  const labels = await loadSeriesLabels(row);
  return toJson({ success: true, state: currentSeriesStatePayload(row, labels) }, 200);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return toJson({ error: "Method not allowed" }, 405);
  }

  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) return toJson({ error: "Unauthorized" }, 401);
  if (!db) return toJson({ error: "Database not initialized" }, 500);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return toJson({ error: "Invalid JSON" }, 400);
  }

  const op = typeof body.action === "string" ? body.action.trim() : "";

  // Reorder operations work on a series/episode, not a single file, so they're
  // dispatched before the per-file ownership lookup below.
  if (op === "reorder") {
    return handleReorderEpisodes(user.id, body);
  }
  if (op === "reorder_items") {
    return handleReorderItems(user.id, body);
  }

  const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";

  if (!fileId || !isValidFileId(fileId)) {
    return toJson({ error: "Invalid fileId" }, 400);
  }

  const row = await loadOwnedFile(fileId, user.id);
  if (!row) return toJson({ error: "Not found" }, 404);

  if (op === "assign") {
    return handleAssign(row, user.id, body);
  }
  if (op === "unassign") {
    return handleUnassign(row, user.id);
  }
  return toJson({ error: "Invalid action" }, 400);
}

/**
 * Reorder a series' episodes. Body: { action:"reorder", fileSeriesId, episodeIds }
 * where `episodeIds` is the FULL ordered list of sibling episodes. Each episode's
 * `episode_number` is rewritten to its 1-based slot; the viewer RPC already sorts
 * by it. Every row is re-checked against the caller's ownership.
 */
async function handleReorderEpisodes(userId: string, body: Record<string, unknown>) {
  if (!db) return toJson({ error: "Database not initialized" }, 500);

  const fileSeriesId = typeof body.fileSeriesId === "string" ? body.fileSeriesId.trim() : "";
  if (!fileSeriesId || !isValidUUID(fileSeriesId)) {
    return toJson({ error: "Invalid file_series_id" }, 400);
  }

  const rawIds = Array.isArray(body.episodeIds) ? body.episodeIds : [];
  const seen = new Set<string>();
  const episodeIds: string[] = [];
  for (const x of rawIds) {
    if (typeof x === "string" && isValidUUID(x) && !seen.has(x)) {
      seen.add(x);
      episodeIds.push(x);
    }
  }
  if (episodeIds.length === 0) {
    return toJson({ error: "episodeIds is required" }, 400);
  }
  if (episodeIds.length > 500) {
    return toJson({ error: "Too many episodes" }, 400);
  }

  // Verify series ownership.
  const { data: seriesRow } = await db
    .from("file_series")
    .select("id")
    .eq("id", fileSeriesId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!seriesRow) return toJson({ error: "Series not found" }, 404);

  // Verify every id is an episode of THIS series owned by the caller — never
  // trust the client's list to be in-scope.
  const { data: ownedEps, error: epsErr } = await db
    .from("files_series_episodes")
    .select("id")
    .eq("feed_series_id", fileSeriesId)
    .eq("owner_id", userId);
  if (epsErr) {
    console.error("[api/file-series] reorder load:", epsErr.message);
    return toJson({ error: "Failed to reorder" }, 500);
  }
  const owned = new Set((ownedEps ?? []).map((e: { id: unknown }) => String(e.id)));
  for (const id of episodeIds) {
    if (!owned.has(id)) {
      return toJson({ error: "Episode not in this series" }, 404);
    }
  }

  // Apply the new 1-based order. Each update stays scoped to the owner + series.
  for (let i = 0; i < episodeIds.length; i++) {
    const { error } = await db
      .from("files_series_episodes")
      .update({ episode_number: i + 1 })
      .eq("id", episodeIds[i])
      .eq("feed_series_id", fileSeriesId)
      .eq("owner_id", userId);
    if (error) {
      console.error("[api/file-series] reorder update:", error.message);
      return toJson({ error: "Failed to reorder" }, 500);
    }
  }

  return toJson({ success: true, order: episodeIds }, 200);
}

/**
 * Reorder the FILES within one episode. Body:
 *   { action:"reorder_items", fileSeriesId, episodeId, fileIds }
 * `fileIds` is the FULL ordered list of the episode's item file ids (unique_ids).
 * Each item's `position` is rewritten to its 1-based slot. Ownership of the
 * series, the episode, AND every referenced item is re-verified server-side.
 */
async function handleReorderItems(userId: string, body: Record<string, unknown>) {
  if (!db) return toJson({ error: "Database not initialized" }, 500);

  const fileSeriesId = typeof body.fileSeriesId === "string" ? body.fileSeriesId.trim() : "";
  if (!fileSeriesId || !isValidUUID(fileSeriesId)) {
    return toJson({ error: "Invalid file_series_id" }, 400);
  }
  const episodeId = typeof body.episodeId === "string" ? body.episodeId.trim() : "";
  if (!episodeId || !isValidUUID(episodeId)) {
    return toJson({ error: "Invalid episode id" }, 400);
  }

  const rawIds = Array.isArray(body.fileIds) ? body.fileIds : [];
  const seen = new Set<string>();
  const fileIds: string[] = [];
  for (const x of rawIds) {
    if (typeof x === "string" && isValidFileId(x) && !seen.has(x)) {
      seen.add(x);
      fileIds.push(x);
    }
  }
  if (fileIds.length === 0) return toJson({ error: "fileIds is required" }, 400);
  if (fileIds.length > 1000) return toJson({ error: "Too many files" }, 400);

  // Verify series ownership.
  const { data: seriesRow } = await db
    .from("file_series")
    .select("id")
    .eq("id", fileSeriesId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!seriesRow) return toJson({ error: "Series not found" }, 404);

  // Verify the episode is in THIS series and owned by the caller.
  const { data: epRow } = await db
    .from("files_series_episodes")
    .select("id")
    .eq("id", episodeId)
    .eq("feed_series_id", fileSeriesId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!epRow) return toJson({ error: "Episode not found" }, 404);

  // Verify every fileId is actually an item of that episode (owner-scoped) —
  // never trust the client's list.
  const { data: items, error: itErr } = await db
    .from("files_series_episode_items")
    .select("file_id")
    .eq("file_episode_id", episodeId)
    .eq("file_series_id", fileSeriesId)
    .eq("owner_id", userId);
  if (itErr) {
    console.error("[api/file-series] reorder_items load:", itErr.message);
    return toJson({ error: "Failed to reorder" }, 500);
  }
  const owned = new Set((items ?? []).map((r: { file_id: unknown }) => String(r.file_id)));
  for (const id of fileIds) {
    if (!owned.has(id)) {
      return toJson({ error: "File not in this episode" }, 404);
    }
  }

  // Apply the new 1-based order; every update stays scoped to owner + series + episode.
  for (let i = 0; i < fileIds.length; i++) {
    const { error } = await db
      .from("files_series_episode_items")
      .update({ position: i + 1 })
      .eq("file_id", fileIds[i])
      .eq("file_episode_id", episodeId)
      .eq("file_series_id", fileSeriesId)
      .eq("owner_id", userId);
    if (error) {
      console.error("[api/file-series] reorder_items update:", error.message);
      return toJson({ error: "Failed to reorder" }, 500);
    }
  }

  return toJson({ success: true, order: fileIds }, 200);
};

async function handleAssign(
  row: FileRow,
  userId: string,
  body: Record<string, unknown>
) {
  if (!db) return toJson({ error: "Database not initialized" }, 500);

  if (row.is_series_main || row.is_files_series_item) {
    return toJson(
      { error: "File is already in a series. Remove it first before re-assigning." },
      409
    );
  }

  const isNewSeries = body.isNewSeries === true;
  const fileSeriesId =
    typeof body.fileSeriesId === "string" ? body.fileSeriesId.trim() : "";
  const fileSeriesEpisodeId =
    typeof body.fileSeriesEpisodeId === "string" ? body.fileSeriesEpisodeId.trim() : "";
  const newEpisodeName = sanitizeString(
    typeof body.newEpisodeName === "string" ? body.newEpisodeName : "",
    EPISODE_NAME_MAX
  ).trim();

  if (isNewSeries) {
    if (!newEpisodeName) {
      return toJson({ error: "Episode name is required for a new series" }, 400);
    }
    return assignAsNewSeries(row, userId, newEpisodeName);
  }

  // Existing series branch
  if (!fileSeriesId || !isValidUUID(fileSeriesId)) {
    return toJson({ error: "Invalid file_series_id" }, 400);
  }

  // Verify series ownership
  const { data: seriesRow, error: serErr } = await db
    .from("file_series")
    .select("id")
    .eq("id", fileSeriesId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (serErr || !seriesRow) {
    return toJson({ error: "Series not found" }, 404);
  }

  let resolvedEpisodeId = fileSeriesEpisodeId;
  if (resolvedEpisodeId) {
    if (!isValidUUID(resolvedEpisodeId)) {
      return toJson({ error: "Invalid file_series_episode_id" }, 400);
    }
    const { data: epRow, error: epErr } = await db
      .from("files_series_episodes")
      .select("id")
      .eq("id", resolvedEpisodeId)
      .eq("feed_series_id", fileSeriesId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (epErr || !epRow) {
      return toJson({ error: "Episode not found in that series" }, 404);
    }
  } else {
    if (!newEpisodeName) {
      return toJson(
        { error: "Either an existing episode or a new episode name is required" },
        400
      );
    }
    const parentEpisodeIdRaw =
      typeof body.parentEpisodeId === "string" ? body.parentEpisodeId.trim() : "";
    let resolvedParentEpisodeId: string | null = null;
    if (parentEpisodeIdRaw) {
      if (!isValidUUID(parentEpisodeIdRaw)) {
        return toJson({ error: "Invalid parent_episode_id" }, 400);
      }
      const { data: parentEp, error: pErr } = await db
        .from("files_series_episodes")
        .select("id")
        .eq("id", parentEpisodeIdRaw)
        .eq("feed_series_id", fileSeriesId)
        .eq("owner_id", userId)
        .maybeSingle();
      if (pErr || !parentEp) {
        return toJson({ error: "Parent episode not found in that series" }, 404);
      }
      resolvedParentEpisodeId = parentEpisodeIdRaw;
    }
    const insertEp: Record<string, unknown> = {
      feed_series_id: fileSeriesId,
      owner_id: userId,
      episode_name: newEpisodeName,
      episode_number: await nextEpisodeNumber(fileSeriesId, userId),
    };
    if (resolvedParentEpisodeId) {
      insertEp.parent_episode_id = resolvedParentEpisodeId;
    }
    const { data: epNew, error: epInsErr } = await db
      .from("files_series_episodes")
      .insert(insertEp)
      .select("id")
      .single();
    if (epInsErr || !epNew?.id) {
      console.error("[api/file-series] episode insert:", epInsErr?.message ?? epInsErr);
      return toJson({ error: "Failed to create episode" }, 500);
    }
    resolvedEpisodeId = String(epNew.id);
  }

  // Link the file as an episode item (NOT the main)
  const { error: fileUpErr } = await db
    .from("files")
    .update({
      is_series_main: false,
      is_files_series_item: true,
      file_series_id: fileSeriesId,
      file_series_episode_id: resolvedEpisodeId,
    })
    .eq("id", row.id)
    .eq("owner_id", userId);
  if (fileUpErr) {
    console.error("[api/file-series] files update (item):", fileUpErr.message);
    return toJson({ error: "Failed to attach file to series" }, 500);
  }

  const { error: itemErr } = await db.from("files_series_episode_items").insert({
    file_series_id: fileSeriesId,
    file_episode_id: resolvedEpisodeId,
    owner_id: userId,
    file_id: row.unique_id,
  });
  if (!itemErr) {
    await applyItemPosition(fileSeriesId, resolvedEpisodeId, row.unique_id, userId);
  }
  if (itemErr) {
    console.error("[api/file-series] item insert:", itemErr.message);
    // Best-effort rollback on the file row so we don't leave an orphan pointer
    await db
      .from("files")
      .update({
        is_series_main: false,
        is_files_series_item: false,
        file_series_id: null,
        file_series_episode_id: null,
      })
      .eq("id", row.id)
      .eq("owner_id", userId);
    return toJson({ error: "Failed to register series membership" }, 500);
  }

  const updatedRow: FileRow = {
    ...row,
    is_series_main: false,
    is_files_series_item: true,
    file_series_id: fileSeriesId,
    file_series_episode_id: resolvedEpisodeId,
  };
  const labels = await loadSeriesLabels(updatedRow);
  return toJson(
    { success: true, state: currentSeriesStatePayload(updatedRow, labels) },
    200
  );
}

async function assignAsNewSeries(row: FileRow, userId: string, episodeName: string) {
  if (!db) return toJson({ error: "Database not initialized" }, 500);

  const { data: seriesRow, error: seriesErr } = await db
    .from("file_series")
    .insert({ file_id: row.unique_id, owner_id: userId })
    .select("id")
    .single();
  if (seriesErr || !seriesRow?.id) {
    console.error("[api/file-series] file_series insert:", seriesErr?.message ?? seriesErr);
    return toJson({ error: "Failed to create series" }, 500);
  }
  const newSeriesId = String(seriesRow.id);

  const { data: epRow, error: epErr } = await db
    .from("files_series_episodes")
    .insert({
      feed_series_id: newSeriesId,
      owner_id: userId,
      episode_name: episodeName,
      episode_number: 1,
    })
    .select("id")
    .single();
  if (epErr || !epRow?.id) {
    console.error("[api/file-series] first episode insert:", epErr?.message ?? epErr);
    // Roll back the empty series so we don't leave a dangling row
    await db.from("file_series").delete().eq("id", newSeriesId).eq("owner_id", userId);
    return toJson({ error: "Failed to create first episode" }, 500);
  }
  const newEpisodeId = String(epRow.id);

  const { error: fileUpErr } = await db
    .from("files")
    .update({
      is_series_main: true,
      is_files_series_item: false,
      file_series_id: newSeriesId,
      file_series_episode_id: newEpisodeId,
    })
    .eq("id", row.id)
    .eq("owner_id", userId);
  if (fileUpErr) {
    console.error("[api/file-series] files update (main):", fileUpErr.message);
    // Roll back the series on failure
    await db
      .from("files_series_episodes")
      .delete()
      .eq("id", newEpisodeId)
      .eq("owner_id", userId);
    await db.from("file_series").delete().eq("id", newSeriesId).eq("owner_id", userId);
    return toJson({ error: "Failed to mark file as series cover" }, 500);
  }

  const { error: itemErr } = await db.from("files_series_episode_items").insert({
    file_series_id: newSeriesId,
    file_episode_id: newEpisodeId,
    owner_id: userId,
    file_id: row.unique_id,
  });
  if (!itemErr) {
    await applyItemPosition(newSeriesId, newEpisodeId, row.unique_id, userId);
  }
  if (itemErr) {
    console.error("[api/file-series] item insert (new series):", itemErr.message);
    // Best-effort rollback
    await db
      .from("files")
      .update({
        is_series_main: false,
        is_files_series_item: false,
        file_series_id: null,
        file_series_episode_id: null,
      })
      .eq("id", row.id)
      .eq("owner_id", userId);
    await db
      .from("files_series_episodes")
      .delete()
      .eq("id", newEpisodeId)
      .eq("owner_id", userId);
    await db.from("file_series").delete().eq("id", newSeriesId).eq("owner_id", userId);
    return toJson({ error: "Failed to register episode" }, 500);
  }

  const updatedRow: FileRow = {
    ...row,
    is_series_main: true,
    is_files_series_item: false,
    file_series_id: newSeriesId,
    file_series_episode_id: newEpisodeId,
  };
  const labels = await loadSeriesLabels(updatedRow);
  return toJson(
    { success: true, state: currentSeriesStatePayload(updatedRow, labels) },
    201
  );
}

async function handleUnassign(row: FileRow, userId: string) {
  if (!db) return toJson({ error: "Database not initialized" }, 500);

  if (row.is_series_main) {
    return toJson(
      {
        error:
          "This file is the cover of a series. Delete the series from its own management to remove it.",
      },
      409
    );
  }

  if (!row.is_files_series_item && !row.file_series_id) {
    return toJson({ error: "File is not in a series" }, 409);
  }

  // Delete join rows (scoped to caller's ownership) before clearing the file row
  const { error: delItemsErr } = await db
    .from("files_series_episode_items")
    .delete()
    .eq("file_id", row.unique_id)
    .eq("owner_id", userId);
  if (delItemsErr) {
    console.error("[api/file-series] item delete:", delItemsErr.message);
    return toJson({ error: "Failed to remove file from series" }, 500);
  }

  const { error: fileUpErr } = await db
    .from("files")
    .update({
      is_series_main: false,
      is_files_series_item: false,
      file_series_id: null,
      file_series_episode_id: null,
    })
    .eq("id", row.id)
    .eq("owner_id", userId);
  if (fileUpErr) {
    console.error("[api/file-series] file clear:", fileUpErr.message);
    return toJson({ error: "Failed to clear series fields on file" }, 500);
  }

  const updatedRow: FileRow = {
    ...row,
    is_series_main: false,
    is_files_series_item: false,
    file_series_id: null,
    file_series_episode_id: null,
  };
  return toJson(
    {
      success: true,
      state: currentSeriesStatePayload(updatedRow, {
        series_title: null,
        episode_name: null,
      }),
    },
    200
  );
}
