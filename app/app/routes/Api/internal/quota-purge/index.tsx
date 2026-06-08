import db from "~/lib/Database/supabase";
import { refundUploadQuota } from "~/lib/uploadQuota.server";
import { isValidUUID } from "~/lib/Security/inputValidation";
import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server";

/**
 * POST /api/internal/quota-purge
 *
 * Webhook-secret-authed call from the Go upload server when a user trips the
 * weekly quota cap. The server has already wiped the user's abandoned chunk
 * folders from disk; this endpoint catches up the database so the user
 * doesn't see broken / stuck "queued" rows in their dashboard:
 *
 *   - Refund the quota ledger for any `purged_upload_ids` the caller hinted
 *     at (so the reservations don't keep counting against this week's cap).
 *   - Sweep deletes EVERY remaining `files` row for this user where
 *     `upload_status = 'queued'`  these are uploads that have completed
 *     chunk upload but the worker hasn't started running them yet. Their
 *     chunks were just deleted on the Go side, so the worker will fail
 *     them anyway; deleting the row pro-actively keeps the dashboard clean.
 *   - NEVER touches rows with `upload_status` in ('running', 'complete'):
 *     `running` is in-flight in the worker (let it finish, its storage is
 *     already spent); `complete` is real shipped content.
 *
 *  Body: { user_id: uuid, purged_upload_ids?: string[] }
 *  Auth: X-Webhook-Secret == UPLOAD_WEBHOOK_SECRET (same secret the worker
 *        already uses for quota-check / quota-record / upload-job-status).
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Upload-id shape produced by the Go server (`crypto/rand` → 32 lowercase hex). */
const UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/;
/** Belt-and-suspenders cap on the per-call refund list. */
const MAX_PURGED_IDS = 256;
/** Belt-and-suspenders cap on the broad "delete every queued row" sweep. */
const MAX_DELETED_ROWS = 1024;

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Webhook secret (constant-time) — same one the worker uses everywhere.
  if (!verifyWebhookSecret(request)) return json({ error: "unauthorized" }, 401);

  if (!db) return json({ error: "unavailable" }, 503);

  let body: { user_id?: unknown; purged_upload_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  // Strict UUID check on user_id. A malformed value would let a compromised
  // caller try to scope the sweep at "all users"; the SQL would still need
  // an .eq filter to match anything, but we reject early to avoid any DB
  // round-trip with attacker-shaped input.
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!userId || !isValidUUID(userId)) return json({ error: "invalid" }, 400);

  // Normalise + filter the hint list. Anything that doesn't match the upload
  // id shape is dropped silently; we never want to pass a wildcard / SQL
  // injection vector to the refund RPC.
  const rawHinted = Array.isArray(body.purged_upload_ids) ? body.purged_upload_ids : [];
  const hintedIds: string[] = [];
  for (const v of rawHinted) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (UPLOAD_ID_PATTERN.test(trimmed)) hintedIds.push(trimmed);
    if (hintedIds.length >= MAX_PURGED_IDS) break;
  }

  // 1. Refund the quota reservation for each hinted upload. Independent
  //    calls so a single failed RPC doesn't block the rest. `refundUploadQuota`
  //    is idempotent  it just runs the refund SQL function, which is safe to
  //    call against an already-refunded row.
  await Promise.allSettled(hintedIds.map((uid) => refundUploadQuota(uid)));

  // 2. Sweep-delete every remaining `queued` row for this user. We scope by
  //    owner_id == user_id (no wildcards, no cross-user reach) and the
  //    `upload_status = 'queued'` predicate so in-flight `running` jobs and
  //    already-shipped `complete` jobs are completely untouched. Capped to
  //    MAX_DELETED_ROWS to defend against an unbounded sweep if the user
  //    somehow has thousands of queued rows.
  let deletedQueued = 0;
  try {
    const { data: queuedRows, error: listErr } = await db
      .from("files")
      .select("unique_id")
      .eq("owner_id", userId)
      .eq("upload_status", "queued")
      .limit(MAX_DELETED_ROWS);

    if (!listErr && Array.isArray(queuedRows) && queuedRows.length > 0) {
      const ids = queuedRows
        .map((r: { unique_id?: unknown }) =>
          typeof r.unique_id === "string" ? r.unique_id.trim() : "",
        )
        .filter((id: string) => UPLOAD_ID_PATTERN.test(id));

      if (ids.length > 0) {
        // Refund their reservations BEFORE deleting the row  once the row
        // is gone the refund RPC can still find the ledger entry by upload
        // id (it doesn't depend on files), but ordering this way means a
        // crashed mid-loop leaves the row in 'queued' state (the next
        // sweep picks it up again) rather than orphan-charging the user.
        await Promise.allSettled(ids.map((uid: string) => refundUploadQuota(uid)));

        const { error: delErr } = await db
          .from("files")
          .delete()
          .eq("owner_id", userId)
          .eq("upload_status", "queued")
          .in("unique_id", ids);
        if (!delErr) deletedQueued = ids.length;
      }
    }
  } catch {
    // Swallow + log generically; the caller doesn't get a useful action
    // out of a DB-side stack trace, and we never leak server detail to
    // the response. The Go side's next attempt will retry the sweep
    // automatically when the user hits the cap again.
  }

  return json({
    ok: true,
    refunded_hinted: hintedIds.length,
    deleted_queued: deletedQueued,
  });
};

export const loader = () => json({ error: "method not allowed" }, 405);
