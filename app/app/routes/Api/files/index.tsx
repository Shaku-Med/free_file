import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId, isValidUUID, sanitizeString } from "~/lib/Security/inputValidation";

const toJson = (body: unknown, status = 200) => data(body, { status });

/** Fields returned to the client for the edit-upload form (no secrets). */
function fileEditResponsePayload(row: Record<string, unknown>) {
  return {
    id: row.id,
    unique_id: row.unique_id,
    file_title: row.file_title ?? null,
    file_description: row.file_description ?? null,
    is_public: row.is_public ?? true,
    categories: row.categories ?? [],
    tags: row.tags ?? [],
    comments_enabled: row.comments_enabled !== false,
    comment_limit: row.comment_limit ?? null,
    default_thumbnail: row.default_thumbnail ?? null,
    file_type: row.file_type ?? null,
    is_adult: row.is_adult ?? false,
    series_id: row.series_id ?? null,
    season_number: row.season_number ?? null,
    episode_number: row.episode_number ?? null,
    is_series_main: row.is_series_main ?? false,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET") {
    return toJson({ error: "Method not allowed" }, 405);
  }

  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) {
    return toJson({ error: "Unauthorized" }, 401);
  }

  if (!db) {
    return toJson({ error: "Database not initialized" }, 500);
  }

  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId")?.trim();
  if (!fileId || !isValidFileId(fileId)) {
    return toJson({ error: "Invalid fileId" }, 400);
  }

  try {
    let row: Record<string, unknown> | null = null;

    const { data: rpcRows, error: rpcError } = await db.rpc("get_file_for_owner_edit", {
      p_lookup: fileId,
      p_viewer_id: user.id,
    });

    if (!rpcError && Array.isArray(rpcRows) && rpcRows[0]) {
      row = rpcRows[0] as Record<string, unknown>;
    } else {
      if (rpcError) {
        console.warn("[api/files GET] get_file_for_owner_edit (fallback):", rpcError.message);
      }
      const lookupField = isValidUUID(fileId) ? "id" : "unique_id";
      const { data: qrow, error: qErr } = await db
        .from("files")
        .select(
          "id, unique_id, file_title, file_description, is_public, categories, tags, comments_enabled, comment_limit, default_thumbnail, file_type, is_adult, series_id, season_number, episode_number, is_series_main"
        )
        .eq(lookupField, fileId)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (qErr) {
        console.error("[api/files GET] fallback query:", qErr);
        return toJson({ error: "Failed to load file" }, 500);
      }
      if (qrow) row = qrow as unknown as Record<string, unknown>;
    }

    if (!row) {
      return toJson({ error: "Not found" }, 404);
    }

    return toJson({ success: true, file: fileEditResponsePayload(row) }, 200);
  } catch (e) {
    console.error("[api/files GET]", e);
    return toJson({ error: "Internal server error" }, 500);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "PATCH") {
      return toJson({ error: "Method not allowed" }, 405);
    }

    const user = await isAuthenticated(request, ["id"]);
    if (!user || !user.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (!db) {
      return toJson({ error: "Database not initialized" }, 500);
    }

    const body = await request.json();
    const { fileId, title, description, isPublic, categories, tags, defaultThumbnail, commentsEnabled, commentLimit, seriesId, episodeNumber, seasonNumber, isSeriesMain } = body || {};

    if (!fileId || !isValidFileId(fileId)) {
      return toJson({ error: "Invalid fileId" }, 400);
    }

    const sanitizedTitle = title !== undefined ? sanitizeString(String(title), 200) : undefined;
    const sanitizedDescription = description !== undefined ? sanitizeString(String(description), 5000) : undefined;

    if (sanitizedTitle !== undefined && sanitizedTitle.length > 200) {
      return toJson({ error: "Title must be 200 characters or less" }, 400);
    }

    if (sanitizedDescription !== undefined && sanitizedDescription.length > 5000) {
      return toJson({ error: "Description must be 5000 characters or less" }, 400);
    }

    if (isPublic !== undefined && typeof isPublic !== "boolean") {
      return toJson({ error: "isPublic must be boolean" }, 400);
    }

    if (categories !== undefined && !Array.isArray(categories)) {
      return toJson({ error: "categories must be an array" }, 400);
    }

    if (tags !== undefined && !Array.isArray(tags)) {
      return toJson({ error: "tags must be an array" }, 400);
    }

    if (commentsEnabled !== undefined && typeof commentsEnabled !== "boolean") {
      return toJson({ error: "commentsEnabled must be boolean" }, 400);
    }

    if (defaultThumbnail !== undefined && typeof defaultThumbnail !== "string") {
      return toJson({ error: "defaultThumbnail must be a string" }, 400);
    }

    const lookupField = isValidUUID(fileId) ? "id" : "unique_id";
    const { data: fileRow, error: fetchError } = await db
      .from("files")
      .select("id, owner_id, file_type")
      .eq(lookupField, fileId)
      .single();

    if (fetchError || !fileRow) {
      return toJson({ error: "File not found" }, 404);
    }

    if (fileRow.owner_id !== user.id) {
      return toJson({ error: "Forbidden" }, 403);
    }

    // Image files use their own endpoint as thumbnail — reject thumbnail changes
    const isImageFile = typeof fileRow.file_type === "string" && fileRow.file_type.startsWith("image/");
    if (isImageFile && typeof defaultThumbnail === "string") {
      return toJson({ error: "Thumbnail cannot be changed for image files" }, 400);
    }

    const updateData: Record<string, any> = {};
    if (sanitizedTitle !== undefined) {
      updateData.file_title = sanitizedTitle.length > 0 ? sanitizedTitle : null;
    }
    if (sanitizedDescription !== undefined) {
      updateData.file_description = sanitizedDescription.length > 0 ? sanitizedDescription : null;
    }
    if (typeof isPublic === "boolean") {
      updateData.is_public = isPublic;
    }
    if (Array.isArray(categories)) {
      updateData.categories = categories
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.trim())
        .slice(0, 20);
    }
    if (Array.isArray(tags)) {
      updateData.tags = tags
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 50))
        .slice(0, 30);
    }
    if (typeof commentsEnabled === "boolean") {
      updateData.comments_enabled = commentsEnabled;
    }
    if (commentLimit !== undefined) {
      // null = unlimited, 0 = disabled, positive integer = limit
      if (commentLimit === null) {
        updateData.comment_limit = null;
      } else if (
        typeof commentLimit === "number" &&
        Number.isInteger(commentLimit) &&
        commentLimit >= 0 &&
        commentLimit <= 1_000_000
      ) {
        updateData.comment_limit = commentLimit;
      } else {
        return toJson({ error: "commentLimit must be null or an integer from 0 to 1000000" }, 400);
      }
    }
    if (typeof defaultThumbnail === "string") {
      updateData.default_thumbnail = defaultThumbnail.length > 0 ? defaultThumbnail : null;
    }
    // seriesId: string uuid = link to series, null = remove from series
    if (seriesId !== undefined) {
      if (seriesId === null) {
        updateData.series_id      = null;
        updateData.season_number  = null;
        updateData.episode_number = null;
      } else if (typeof seriesId === "string" && /^[0-9a-f-]{36}$/i.test(seriesId)) {
        updateData.series_id = seriesId;
      } else {
        return toJson({ error: "seriesId must be a valid UUID or null" }, 400);
      }
    }
    if (episodeNumber !== undefined) {
      if (episodeNumber === null) {
        updateData.episode_number = null;
      } else if (typeof episodeNumber === "number" && Number.isInteger(episodeNumber) && episodeNumber >= 1 && episodeNumber <= 9999) {
        updateData.episode_number = episodeNumber;
      } else {
        return toJson({ error: "episodeNumber must be an integer from 1 to 9999 or null" }, 400);
      }
    }
    if (seasonNumber !== undefined) {
      if (seasonNumber === null) {
        updateData.season_number = null;
      } else if (typeof seasonNumber === "number" && Number.isInteger(seasonNumber) && seasonNumber >= 1 && seasonNumber <= 999) {
        updateData.season_number = seasonNumber;
      } else {
        return toJson({ error: "seasonNumber must be an integer from 1 to 999 or null" }, 400);
      }
    }
    if (isSeriesMain !== undefined) {
      if (typeof isSeriesMain !== "boolean") {
        return toJson({ error: "isSeriesMain must be boolean" }, 400);
      }
      // Only meaningful when the file is already part of a series
      updateData.is_series_main = isSeriesMain;
    }

    if (Object.keys(updateData).length === 0) {
      return toJson({ error: "No changes provided" }, 400);
    }

    const { data: updatedFile, error: updateError } = await db
      .from("files")
      .update(updateData)
      .eq(lookupField, fileId)
      .select("id, file_title, file_description, is_public, categories, tags, comments_enabled, comment_limit, default_thumbnail, series_id, season_number, episode_number, is_series_main")
      .single();

    if (updateError) {
      console.error("Failed to update file:", updateError);
      return toJson({ error: "Failed to update file" }, 500);
    }

    return toJson({ success: true, file: updatedFile }, 200);
  } catch (error) {
    console.error("Error updating file:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
