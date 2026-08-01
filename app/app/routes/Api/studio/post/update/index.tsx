import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import {
  canOwnerChangeVisibility,
  isFileVisibility,
  visibilityOf,
  type FileVisibility,
} from "~/lib/Security/visibility";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

/**
 * Only these keys are ever read off the request. Everything else a client sends
 * is ignored, so `visibility_locked`, `moderation_flag`, `is_adult` and friends
 * cannot be set from outside no matter what the body contains.
 */
interface UpdateBody {
  unique_id?: unknown;
  file_title?: unknown;
  file_description?: unknown;
  /** Legacy: true means public, false means private. `visibility` wins. */
  is_public?: unknown;
  visibility?: unknown;
  tags?: unknown;
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") return denyErr(405);
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    let body: UpdateBody;
    try {
      body = (await request.json()) as UpdateBody;
    } catch {
      return denyErr(400);
    }

    const uniqueId = typeof body.unique_id === "string" ? body.unique_id : "";
    if (!uniqueId || uniqueId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(uniqueId)) {
      return denyErr(400);
    }

    const { data: existing, error: lookupErr } = await db
      .from("files")
      .select("id, owner_id, visibility, is_public, visibility_locked")
      .eq("unique_id", uniqueId)
      .maybeSingle();
    if (lookupErr) {
      console.error("[studio/post/update] lookup", lookupErr);
      return denyErr(500);
    }
    if (!existing) return denyErr(404);
    if ((existing as { owner_id: string }).owner_id !== user.id) return denyErr(403);

    const patch: Record<string, unknown> = {};
    if (typeof body.file_title === "string") {
      const v = body.file_title.trim();
      if (v.length > 200) return denyErr(400);
      patch.file_title = v;
    }
    if (typeof body.file_description === "string") {
      const v = body.file_description;
      if (v.length > 5000) return denyErr(400);
      patch.file_description = v;
    }
    // Visibility. `visibility` is authoritative; `is_public` is still accepted
    // so older clients keep working, and is translated rather than written raw.
    let requested: FileVisibility | null = null;
    if (isFileVisibility(body.visibility)) {
      requested = body.visibility;
    } else if (typeof body.is_public === "boolean") {
      requested = body.is_public ? "public" : "private";
    } else if (body.visibility !== undefined || body.is_public !== undefined) {
      // Present but not a value we recognise: reject rather than guess.
      return denyErr(400);
    }

    if (requested !== null) {
      const current = visibilityOf(existing as Record<string, unknown>);
      // Re-sending the value it already has is a no-op, not an attempt to
      // change anything, so a UI that always submits the current setting still
      // works on a locked file.
      if (requested !== current) {
        // The owner does not get to undo a moderation decision. The database
        // trigger refuses this too; this check exists so the caller gets a
        // usable error instead of a 500 out of Postgres.
        if (!canOwnerChangeVisibility(existing as Record<string, unknown>)) {
          return toJson(
            { error: "Visibility is locked pending review.", code: "visibility_locked" },
            403,
          );
        }
        patch.visibility = requested;
      }
    }
    if (Array.isArray(body.tags)) {
      const tags = body.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 40)
        .slice(0, 30);
      patch.tags = tags;
    }

    if (Object.keys(patch).length === 0) return denyErr(400);

    const { error: updErr } = await db
      .from("files")
      .update(patch)
      .eq("id", (existing as { id: string }).id);
    if (updErr) {
      console.error("[studio/post/update] update", updErr);
      return denyErr(500);
    }

    return toJson({ success: true });
  } catch (e) {
    console.error("[studio/post/update] unexpected", e);
    return denyErr(500);
  }
};

export const loader = () => denyErr(405);
