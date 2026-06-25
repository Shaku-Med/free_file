/**
 * POST /api/studio/post/delete  permanent, unrecoverable delete.
 *
 * Gates (ALL must pass, every call):
 *   1. logged in
 *   2. delete-sudo cookie valid for THIS user (email-code verified, <2h old)
 *   3. the file's owner_id equals the caller  nobody deletes anyone else's content
 *
 * Then: purge the file's whole storage directory via GoUpload /internal/purge
 * (R2 or GitHub, whichever holds it) FIRST, and only delete the DB row once
 * storage is gone  a failed purge leaves the row so the user can retry,
 * never an orphaned directory we'd pay for forever. Likes / comments /
 * fingerprints etc. go with the row via FK cascades.
 */
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { hasDeleteSudo } from "~/lib/Security/deleteSudo.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

/** Upload states where the worker may still be writing  deletion is blocked. */
const PROCESSING_STATES = new Set(["queued", "running", "processing", "pending", "uploading"]);

/** The only storage-directory shape the purge endpoint accepts. */
const PREFIX_PATTERN = /^\d{2}_\d{2}_\d{4}\/[a-f0-9]{32}\//;

const PURGE_TIMEOUT_MS = 90_000;

function storagePrefixFor(row: {
  endpoint?: string | null;
  thumbnails?: unknown;
  default_thumbnail?: string | null;
}): string | null {
  const candidates: string[] = [];
  if (typeof row.endpoint === "string") candidates.push(row.endpoint);
  if (typeof row.default_thumbnail === "string") candidates.push(row.default_thumbnail);
  if (Array.isArray(row.thumbnails)) {
    for (const t of row.thumbnails) if (typeof t === "string") candidates.push(t);
  }
  for (const c of candidates) {
    const m = PREFIX_PATTERN.exec(c.replace(/^\/+/, ""));
    if (m) return m[0];
  }
  return null;
}

/** True when the storage directory is gone (or there was nothing to purge). */
async function purgeStorage(row: {
  endpoint?: string | null;
  thumbnails?: unknown;
  default_thumbnail?: string | null;
  storage_backend?: string | null;
  github_repo?: string | null;
}): Promise<boolean> {
  const base = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || "").replace(/\/$/, "");
  const secret = process.env.UPLOAD_WEBHOOK_SECRET || "";
  const prefix = storagePrefixFor(row);
  // Legacy rows without a recognizable directory have nothing we can purge;
  // don't block the user's delete on them.
  if (!prefix) return true;
  if (!base || !secret) return false;

  const repo = typeof row.github_repo === "string" ? row.github_repo.trim() : "";
  const backend =
    row.storage_backend === "r2" || row.storage_backend === "github"
      ? row.storage_backend
      : repo
        ? "github"
        : "r2";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PURGE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/internal/purge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify({ backend, prefix, ...(backend === "github" ? { repo } : {}) }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") return denyErr(405);
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    let body: { unique_id?: unknown };
    try {
      body = (await request.json()) as { unique_id?: unknown };
    } catch {
      return denyErr(400);
    }
    const uniqueId = typeof body.unique_id === "string" ? body.unique_id : "";
    if (!uniqueId || uniqueId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(uniqueId)) {
      return denyErr(400);
    }

    const { data: existing, error: lookupErr } = await db
      .from("files")
      .select("id, owner_id, endpoint, thumbnails, default_thumbnail, storage_backend, github_repo, upload_status")
      .eq("unique_id", uniqueId)
      .maybeSingle();
    if (lookupErr) {
      console.error("[studio/post/delete] lookup", lookupErr);
      return denyErr(500);
    }
    if (!existing) return denyErr(404);
    if ((existing as { owner_id: string }).owner_id !== user.id) return denyErr(403);

    // Never delete a file the upload worker is still writing to: purging its
    // storage mid-process races the worker and can orphan the directory (which
    // we pay for) or strand a half-processed row. Only complete / failed
    // (terminal) uploads are deletable. Legacy rows with no status are allowed.
    const status = (existing as { upload_status?: string | null }).upload_status;
    if (typeof status === "string" && PROCESSING_STATES.has(status.toLowerCase())) {
      return toJson(
        { error: "processing", message: "This video is still processing. You can delete it once it finishes." },
        409,
      );
    }

    // Sudo gate AFTER ownership: an attacker probing other people's ids gets
    // 403 and never learns whether their own sudo state matters.
    if (!(await hasDeleteSudo(request, user.id))) {
      return toJson({ error: "verification_required" }, 401);
    }

    if (!(await purgeStorage(existing as Record<string, unknown>))) {
      console.error("[studio/post/delete] storage purge failed", uniqueId);
      return denyErr(502);
    }

    const { error: delErr } = await db
      .from("files")
      .delete()
      .eq("id", (existing as { id: string }).id)
      .eq("owner_id", user.id);
    if (delErr) {
      console.error("[studio/post/delete] delete", delErr);
      return denyErr(500);
    }

    return toJson({ success: true });
  } catch (e) {
    console.error("[studio/post/delete] unexpected", e);
    return denyErr(500);
  }
};

export const loader = () => denyErr(405);
