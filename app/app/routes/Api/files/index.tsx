import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId, isValidUUID, sanitizeString } from "~/lib/Security/inputValidation";
import { invalidateFileByUniqueId } from "~/lib/Services/accessCache.server";

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
    metadata: row.metadata ?? null,
    captions: normalizeCaptions(row.captions),
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
          "id, unique_id, file_title, file_description, is_public, categories, tags, comments_enabled, comment_limit, default_thumbnail, file_type, is_adult, metadata, captions"
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
    const { fileId, title, description, isPublic, categories, tags, defaultThumbnail, commentsEnabled, commentLimit, markers } = body || {};

    /**
     * Skip-intro / next-episode markers  owner-edited, baked into `metadata.markers` so
     * every viewer's player picks them up automatically. Each field accepts a non-negative
     * number (seconds) or null to clear it. We sanity-check the relationship between the
     * intro start/end so the player can't get into a state where the skip button never hides.
     */
    let parsedMarkers: { introStart: number | null; introEnd: number | null; creditsStart: number | null } | undefined;
    if (markers !== undefined) {
      if (markers === null) {
        parsedMarkers = { introStart: null, introEnd: null, creditsStart: null };
      } else if (typeof markers !== "object") {
        return toJson({ error: "markers must be an object or null" }, 400);
      } else {
        const m = markers as Record<string, unknown>;
        const coerce = (k: string): number | null | undefined => {
          if (!(k in m)) return undefined;
          const v = m[k];
          if (v === null) return null;
          if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 86_400) return v;
          return Symbol() as unknown as number; // sentinel for "invalid"
        };
        const isStart = coerce("introStart");
        const isEnd = coerce("introEnd");
        const cStart = coerce("creditsStart");
        if (typeof isStart === "symbol" || typeof isEnd === "symbol" || typeof cStart === "symbol") {
          return toJson({ error: "markers values must be non-negative numbers (seconds) or null" }, 400);
        }
        if (
          typeof isStart === "number" &&
          typeof isEnd === "number" &&
          isEnd <= isStart
        ) {
          return toJson({ error: "markers.introEnd must be greater than markers.introStart" }, 400);
        }
        parsedMarkers = {
          introStart: isStart === undefined ? null : (isStart as number | null),
          introEnd: isEnd === undefined ? null : (isEnd as number | null),
          creditsStart: cStart === undefined ? null : (cStart as number | null),
        };
      }
    }

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
      .select("id, unique_id, owner_id, file_type, metadata")
      .eq(lookupField, fileId)
      .single();

    if (fetchError || !fileRow) {
      return toJson({ error: "File not found" }, 404);
    }

    if (fileRow.owner_id !== user.id) {
      return toJson({ error: "Forbidden" }, 403);
    }

    // Image files use their own endpoint as thumbnail  reject thumbnail changes
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

    /** Merge markers into the existing metadata jsonb so we don't clobber other keys. */
    if (parsedMarkers !== undefined) {
      const existingMeta =
        fileRow.metadata && typeof fileRow.metadata === "object" && !Array.isArray(fileRow.metadata)
          ? (fileRow.metadata as Record<string, unknown>)
          : {};
      const allNull =
        parsedMarkers.introStart === null &&
        parsedMarkers.introEnd === null &&
        parsedMarkers.creditsStart === null;
      const nextMeta: Record<string, unknown> = { ...existingMeta };
      if (allNull) {
        delete nextMeta.markers;
      } else {
        nextMeta.markers = parsedMarkers;
      }
      updateData.metadata = nextMeta;
    }

    if (Object.keys(updateData).length === 0) {
      return toJson({ error: "No changes provided" }, 400);
    }

    const { data: updatedFile, error: updateError } = await db
      .from("files")
      .update(updateData)
      .eq(lookupField, fileId)
      .select("id, file_title, file_description, is_public, categories, tags, comments_enabled, comment_limit, default_thumbnail, metadata")
      .single();

    if (updateError) {
      console.error("Failed to update file:", updateError);
      return toJson({ error: "Failed to update file" }, 500);
    }

    // Visibility / NSFW / metadata may have changed  drop the cached row so the next
    // segment / image / manifest fetch revalidates against Supabase.
    invalidateFileByUniqueId(
      typeof fileRow.unique_id === "string" ? fileRow.unique_id : null,
    );

    return toJson({ success: true, file: updatedFile }, 200);
  } catch (error) {
    console.error("Error updating file:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};

function normalizeCaptions(raw: unknown): { language: string; path: string }[] {
  let arr: unknown[] | null = null;
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try { arr = JSON.parse(raw); } catch { /* not JSON */ }
  }
  if (!arr || !Array.isArray(arr)) return [];
  const out: { language: string; path: string }[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const lang = typeof e.language === "string" ? e.language.trim() : "";
    const path = typeof e.path === "string" ? e.path.trim() : "";
    if (lang) out.push({ language: lang, path });
  }
  return out;
}
