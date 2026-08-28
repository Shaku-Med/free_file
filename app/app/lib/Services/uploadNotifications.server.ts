import db from "~/lib/Database/supabase";
import { sendPushToUser } from "./PushService";
import { NOTIFICATION_EXPIRY_DAYS } from "./NotificationService";
import { sendEmailDirectly } from "~/routes/Auth/fun/email";
import { BASE_URL } from "~/lib/URLS";

/** Longest title we put in a push body or a subject line. */
const MAX_TITLE = 80;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function expiresAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + NOTIFICATION_EXPIRY_DAYS);
  return d.toISOString();
}

/**
 * Tell an uploader their file finished processing.
 *
 * This runs in the app rather than in GoUpload on purpose: the VAPID keys, the
 * mail key, the push subscriptions and the users table all live here, and web
 * push from Go would mean reimplementing VAPID signing and payload encryption
 * for nothing. GoUpload keeps posting to /api/upload-job-status; this fans out.
 *
 * Never throws. A failed notification must not fail the webhook, or the worker
 * retries a job whose file is already written.
 */
export async function notifyUploadReady(fileId: string): Promise<void> {
  if (!db || !fileId) return;

  try {
    /**
     * Owner and title are read back from the row we just wrote, never taken
     * from the webhook body. The webhook is secret authenticated, but the
     * caller still should not get to choose who gets told about a file.
     */
    const { data: file, error } = await db
      .from("files")
      .select("id, owner_id, unique_id, file_title, filename")
      .eq("id", fileId)
      .maybeSingle();

    if (error || !file?.owner_id) return;

    /**
     * The insert IS the claim. The worker retries the completion webhook, and
     * a check-then-insert would still let two concurrent retries both pass the
     * check and notify twice, so the partial unique index decides it: whoever
     * inserts sends, the loser stops here before any push or mail goes out.
     */
    const claimed = await writeNotification(file.owner_id, "upload_ready", file.id);
    if (!claimed) return;

    const title = pickTitle(file.file_title, file.filename);
    const url = file.unique_id ? `${BASE_URL}/${file.unique_id}` : BASE_URL;

    // Independent channels: a dead push subscription must not cost the email.
    await Promise.allSettled([
      sendPushToUser(file.owner_id, {
        title: "Your upload is ready",
        body: title,
        url,
      }),
      sendUploadEmail(file.owner_id, "ready", title, url),
    ]);
  } catch (err) {
    console.error("[uploadNotify] ready:", err);
  }
}

/**
 * Tell an uploader their file could not be processed.
 *
 * Takes the owner and title as arguments because the failure path deletes the
 * files row: by the time this runs there is nothing left to read, and nothing
 * for notifications.file_id to reference either. The caller captures both from
 * the delete itself, so the values still come from the database rather than
 * from the request body.
 */
export async function notifyUploadFailed(
  ownerId: string,
  fileTitle: string | null,
  fileName: string | null,
): Promise<void> {
  if (!db || !ownerId) return;

  try {
    const title = pickTitle(fileTitle, fileName);

    // Not gated on the insert: upload_failed carries a NULL file_id, so the
    // unique index cannot cover it. The caller already deduped exactly by
    // only calling when the delete actually removed a row.
    await writeNotification(ownerId, "upload_failed", null);

    await Promise.allSettled([
      sendPushToUser(ownerId, {
        title: "Upload failed",
        body: `${title} could not be processed`,
        url: `${BASE_URL}/upload`,
      }),
      sendUploadEmail(ownerId, "failed", title, `${BASE_URL}/upload`),
    ]);
  } catch (err) {
    console.error("[uploadNotify] failed:", err);
  }
}

function pickTitle(fileTitle: unknown, fileName: unknown): string {
  const t =
    (typeof fileTitle === "string" && fileTitle.trim()) ||
    (typeof fileName === "string" && fileName.trim()) ||
    "Your upload";
  return t.slice(0, MAX_TITLE);
}

/**
 * Written straight to the table rather than through createNotification, which
 * drops any notification whose actor is its recipient. That guard is right for
 * social events and wrong here: this one comes from the system, and actor_id
 * is NOT NULL with a foreign key, so the owner stands in for it.
 */
async function writeNotification(
  userId: string,
  type: "upload_ready" | "upload_failed",
  fileId: string | null,
): Promise<boolean> {
  if (!db) return false;
  const { error } = await db.from("notifications").insert({
    user_id: userId,
    type,
    actor_id: userId,
    file_id: fileId,
    expires_at: expiresAt(),
  });
  if (!error) return true;
  // 23505 is a unique violation: someone already claimed this one, which is
  // the retry case and not worth logging as a failure.
  if ((error as { code?: string }).code !== "23505") {
    console.error("[uploadNotify] insert:", error.message);
  }
  return false;
}

async function sendUploadEmail(
  ownerId: string,
  outcome: "ready" | "failed",
  title: string,
  url: string,
): Promise<void> {
  if (!db) return;

  // Address comes from the users row, never from the request.
  const { data: user } = await db
    .from("users")
    .select("email, username")
    .eq("id", ownerId)
    .maybeSingle();

  const to = typeof user?.email === "string" ? user.email.trim() : "";
  if (!to) return;

  // The title is whatever the uploader named their file, so it is escaped
  // before it goes anywhere near the markup.
  const safeTitle = escapeHtml(title);
  const safeName = escapeHtml(
    (typeof user?.username === "string" && user.username.trim()) || "there",
  );

  const ready = outcome === "ready";
  const subject = ready ? `${title} is ready to watch` : `${title} could not be processed`;
  const lead = ready
    ? "Your upload finished processing and is live now."
    : "Something went wrong while processing your upload. Nothing was published.";
  const cta = ready ? "Watch it" : "Try again";

  await sendEmailDirectly({
    to,
    subject,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
        <p style="margin:0 0 12px">Hey ${safeName},</p>
        <p style="margin:0 0 16px">${lead}</p>
        <p style="margin:0 0 20px;font-weight:600">${safeTitle}</p>
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">${cta}</a>
        <p style="margin:24px 0 0;font-size:12px;color:#666">You are getting this because you uploaded to Memories.</p>
      </div>
    `,
  });
}
