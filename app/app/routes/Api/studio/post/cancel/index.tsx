/**
 * POST /api/studio/post/cancel: the owner stops an upload while it processes,
 * and it is rolled back: gone from their channel at once, its storage quota
 * refunded, and every file it had stored deleted.
 *
 * Gates (ALL must pass, every call): same origin, signed in, rate limited, the
 * caller owns the file, the file is still processing (a finished one goes
 * through delete), and the same email-code check as delete, since this is just
 * as permanent and a live video with HD still encoding can be stopped too.
 *
 * GoUpload is told first and must accept, or nothing changes: it flags the job
 * so the worker drops it at its next step and deletes what it uploaded, and
 * purges anything already stored under a known folder right away. Removing the
 * row without that would leave a worker publishing into a deleted upload.
 */
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { hasDeleteSudo } from "~/lib/Security/deleteSudo.server";
import { isSameOrigin } from "~/lib/Security/sameOrigin.server";
import { rateLimiter } from "~/routes/Auth/fun/rateLimit.server";
import { refundUploadQuota } from "~/lib/uploadQuota.server";
import { hasPendingQualities, isStillProcessing } from "~/lib/files/uploadStatus";
import { storagePrefixFor } from "~/lib/files/storagePrefix";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const denyErr = (status = 500) => toJson({ error: "Something's wrong." }, status);

/** Uploads that can still be processing all have 32 hex character ids. */
const UPLOAD_ID = /^[a-f0-9]{32}$/;
const CANCEL_TIMEOUT_MS = 90_000;

/** True once GoUpload has flagged the upload and cleared what it already stored. */
async function cancelInGoUpload(uploadId: string, prefix: string | null): Promise<boolean> {
  const base = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || "").replace(/\/$/, "");
  const secret = process.env.UPLOAD_WEBHOOK_SECRET || "";
  // Fail closed: without GoUpload the worker would keep going.
  if (!base || !secret) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CANCEL_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/internal/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ upload_id: uploadId, ...(prefix ? { prefix } : {}) }),
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
    if (!isSameOrigin(request)) return denyErr(403);
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return denyErr(401);

    const limit = await rateLimiter.checkLimit(user.id, "studio-cancel-upload", 20, 60_000, 5 * 60_000);
    if (!limit.allowed) return toJson({ error: limit.error ?? "Too many requests" }, 429);

    let body: { unique_id?: unknown };
    try {
      body = await request.json();
    } catch {
      return denyErr(400);
    }
    const uniqueId = typeof body?.unique_id === "string" ? body.unique_id.trim() : "";
    if (!UPLOAD_ID.test(uniqueId)) return denyErr(400);

    const { data: row, error: lookupErr } = await db
      .from("files")
      .select("id, owner_id, upload_status, processing_progress, created_at, endpoint, thumbnails, default_thumbnail, storage_backend")
      .eq("unique_id", uniqueId)
      .maybeSingle();
    if (lookupErr) {
      console.error("[studio/post/cancel] lookup", lookupErr);
      return denyErr(500);
    }
    if (!row) return denyErr(404);
    if ((row as { owner_id: string }).owner_id !== user.id) return denyErr(403);

    if (!isStillProcessing(row.upload_status) && !hasPendingQualities(row)) {
      return toJson({ error: "not_processing", message: "This upload has finished processing." }, 409);
    }

    // Sudo gate AFTER ownership, as on delete.
    if (!(await hasDeleteSudo(request, user.id))) {
      return toJson({ error: "verification_required" }, 401);
    }

    // New uploads all live on R2; only an R2 folder is purged from here.
    const prefix = row.storage_backend === "github" ? null : storagePrefixFor(row);
    if (!(await cancelInGoUpload(uniqueId, prefix))) {
      console.error("[studio/post/cancel] GoUpload refused or unreachable", uniqueId);
      return denyErr(502);
    }

    const { error: delErr } = await db
      .from("files")
      .delete()
      .eq("id", (row as { id: string }).id)
      .eq("owner_id", user.id);
    if (delErr) {
      console.error("[studio/post/cancel] delete", delErr);
      return denyErr(500);
    }

    // Rolled back, so the upload no longer counts against the owner's quota.
    await refundUploadQuota(uniqueId);

    return toJson({ success: true });
  } catch (e) {
    console.error("[studio/post/cancel] unexpected", e);
    return denyErr(500);
  }
};

export const loader = () => denyErr(405);
