/**
 * Shared access checks for comment surfaces. Reads and writes both go through
 * here so a private or owner-hidden thread can't be reached by guessing ids.
 */

import db from "~/lib/Database/supabase";
import { canAccessFile } from "~/routes/Api/fun/accessControl";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });

const MAX_HIDDEN_WALK = 32;

/**
 * Returns null when the viewer may read the file's comments; otherwise the
 * response to send. Missing and forbidden files both look like 404.
 */
export async function denyIfFileUnreadable(
  request: Request,
  fileId: string,
): Promise<Response | null> {
  if (!db) return toJson({ error: "Database not initialized" }, 500);
  const { data: file } = await db
    .from("files")
    .select("id, owner_id, is_public, visibility, visibility_locked, is_adult, upload_status")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return toJson({ error: "Not found" }, 404);
  const allowed = await canAccessFile(request, file as never);
  if (!allowed) return toJson({ error: "Not found" }, 404);
  return null;
}

export type CommentAccessRow = {
  id: string;
  file_id: string;
  parent_id: string | null;
  is_deleted: boolean;
  is_hidden: boolean;
  owner_id: string | null;
};

/**
 * Load a comment plus its file owner. Null when the row is gone or soft deleted.
 */
function missingHiddenColumn(err: { message?: string; details?: string; hint?: string } | null): boolean {
  if (!err) return false;
  const text = `${err.message || ""} ${err.details || ""} ${err.hint || ""}`.toLowerCase();
  return text.includes("is_hidden");
}

export async function loadCommentForAccess(
  commentId: string,
): Promise<CommentAccessRow | null> {
  if (!db) return null;
  let { data: comment, error } = await db
    .from("comments")
    .select("id, file_id, parent_id, is_deleted, is_hidden")
    .eq("id", commentId)
    .maybeSingle();
  if (error && missingHiddenColumn(error)) {
    ({ data: comment, error } = await db
      .from("comments")
      .select("id, file_id, parent_id, is_deleted")
      .eq("id", commentId)
      .maybeSingle());
  }
  if (error || !comment || comment.is_deleted) return null;

  const { data: file } = await db
    .from("files")
    .select("owner_id")
    .eq("id", comment.file_id)
    .maybeSingle();

  return {
    id: String(comment.id),
    file_id: String(comment.file_id),
    parent_id: (comment.parent_id as string | null) ?? null,
    is_deleted: Boolean(comment.is_deleted),
    is_hidden: Boolean((comment as { is_hidden?: boolean }).is_hidden),
    owner_id: file?.owner_id ? String(file.owner_id) : null,
  };
}

/**
 * Walk ancestors. True when this comment or anything above it is hidden.
 * Null when the chain leaves the file (treat as deny).
 */
export async function isCommentBranchHidden(
  commentId: string,
  fileId: string,
): Promise<boolean | null> {
  if (!db) return null;
  let cursor: string | null = commentId;
  for (let depth = 0; cursor && depth < MAX_HIDDEN_WALK; depth++) {
    const { data, error } = await db
      .from("comments")
      .select("parent_id, is_hidden, file_id")
      .eq("id", cursor)
      .maybeSingle();
    if (error) {
      // Pre-migration schema has no is_hidden: nothing can be hidden.
      if (String(error.message || "").toLowerCase().includes("is_hidden")) return false;
      return null;
    }
    const row = data as {
      parent_id?: string | null;
      is_hidden?: boolean;
      file_id?: string;
    } | null;
    if (!row || row.file_id !== fileId) return null;
    if (row.is_hidden) return true;
    cursor = row.parent_id ?? null;
  }
  return false;
}

/**
 * Full gate for a comment id: file visibility, then hidden branch for
 * everyone except the file owner. Same 404 shape as the comments loader.
 */
export async function denyIfCommentUnreadable(
  request: Request,
  commentId: string,
  viewerId: string | null,
): Promise<{ denied: Response } | { denied: null; comment: CommentAccessRow }> {
  const comment = await loadCommentForAccess(commentId);
  if (!comment) return { denied: toJson({ error: "Not found" }, 404) };

  const fileDenied = await denyIfFileUnreadable(request, comment.file_id);
  if (fileDenied) return { denied: fileDenied };

  const viewerIsOwner = Boolean(viewerId && comment.owner_id && viewerId === comment.owner_id);
  if (!viewerIsOwner) {
    const hidden = await isCommentBranchHidden(comment.id, comment.file_id);
    if (hidden === null || hidden) {
      return { denied: toJson({ error: "Not found" }, 404) };
    }
  }

  return { denied: null, comment };
}

/**
 * Parent must live on the same file, not be deleted, and not sit under a
 * hidden branch (unless the poster is the file owner).
 */
export async function denyIfParentUnusable(
  fileId: string,
  parentId: string,
  viewerId: string,
): Promise<Response | null> {
  if (!db) return toJson({ error: "Database not initialized" }, 500);
  const { data: parent } = await db
    .from("comments")
    .select("id, file_id, is_deleted, is_hidden")
    .eq("id", parentId)
    .maybeSingle();
  if (!parent || parent.is_deleted || parent.file_id !== fileId) {
    return toJson({ error: "Invalid parent comment" }, 400);
  }

  const { data: file } = await db
    .from("files")
    .select("owner_id")
    .eq("id", fileId)
    .maybeSingle();
  const viewerIsOwner = Boolean(file?.owner_id && viewerId === file.owner_id);
  if (!viewerIsOwner) {
    const hidden = await isCommentBranchHidden(parentId, fileId);
    if (hidden === null || hidden) {
      return toJson({ error: "Invalid parent comment" }, 400);
    }
  }
  return null;
}

/** GIF urls we accept on create. Keep this tight so posts can't store XSS or tracking links. */
export function isAllowedCommentGifUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "media.giphy.com" ||
      host === "i.giphy.com" ||
      host === "media0.giphy.com" ||
      host === "media1.giphy.com" ||
      host === "media2.giphy.com" ||
      host === "media3.giphy.com" ||
      host === "media4.giphy.com" ||
      host.endsWith(".giphy.com") ||
      host === "media.tenor.com" ||
      host.endsWith(".tenor.com")
    );
  } catch {
    return false;
  }
}
