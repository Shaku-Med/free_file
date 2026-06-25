import db from "~/lib/Database/supabase";
import { sendPushToUser } from "~/lib/Services/PushService";
import type { NotificationType } from "~/lib/Services/NotificationService";

/**
 * Debounced + coalesced push delivery.
 *
 * Events (like / comment / subscribe) call enqueuePush instead of pushing
 * immediately. The push fires PUSH_DELAY_SECONDS later, so a quick undo
 * (cancelPush from an unlike / unsubscribe) stops it, and multiple events in
 * the window collapse into one message. A single in-process timer flushes the
 * outbox table  no Redis, fits the single-container server.
 */

const PUSH_DELAY_SECONDS = 60;
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BATCH = 50;

let flusherStarted = false;

function startPushFlusher() {
  if (flusherStarted || typeof setInterval === "undefined") return;
  flusherStarted = true;
  const timer = setInterval(() => {
    void flushDuePushes();
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive just for the flusher.
  (timer as { unref?: () => void }).unref?.();
}

export async function enqueuePush(
  recipientId: string,
  type: NotificationType,
  actorId: string,
  fileId?: string | null,
  commentId?: string | null,
): Promise<void> {
  if (!db || !recipientId || recipientId === actorId) return;
  startPushFlusher();
  try {
    await db.rpc("enqueue_push", {
      p_recipient: recipientId,
      p_type: type,
      p_actor: actorId,
      p_file: fileId ?? null,
      p_comment: commentId ?? null,
      p_delay_seconds: PUSH_DELAY_SECONDS,
    });
  } catch (e) {
    console.error("[PushQueue] enqueue failed:", e);
  }
}

/** Undo a pending push when the action is reversed (unlike, unsubscribe). */
export async function cancelPush(
  recipientId: string,
  type: NotificationType,
  actorId: string,
  fileId?: string | null,
  commentId?: string | null,
): Promise<void> {
  if (!db || !recipientId || recipientId === actorId) return;
  try {
    await db.rpc("cancel_push", {
      p_recipient: recipientId,
      p_type: type,
      p_actor: actorId,
      p_file: fileId ?? null,
      p_comment: commentId ?? null,
    });
  } catch (e) {
    console.error("[PushQueue] cancel failed:", e);
  }
}

function coalescedMessage(type: NotificationType, actorName: string, others: number): string {
  const who = others > 0 ? `${actorName} and ${others} other${others === 1 ? "" : "s"}` : actorName;
  switch (type) {
    case "file_like":
      return `${who} liked your video`;
    case "file_comment":
      return `${who} commented on your video`;
    case "comment_reply":
      return `${who} replied to your comment`;
    case "comment_like":
      return `${who} liked your comment`;
    case "comment_mention":
      return `${who} mentioned you in a comment`;
    case "new_subscriber":
      return `${who} subscribed to your channel`;
    default:
      return `${who} sent you a notification`;
  }
}

interface DuePush {
  recipient_id: string;
  type: NotificationType;
  file_id: string | null;
  comment_id: string | null;
  last_actor_id: string | null;
  actor_count: number;
}

/** Send every push whose delay has elapsed, coalesced into one message each. */
export async function flushDuePushes(): Promise<void> {
  if (!db) return;
  let due: DuePush[] = [];
  try {
    const { data } = await db.rpc("flush_due_pushes", { p_limit: FLUSH_BATCH });
    due = Array.isArray(data) ? (data as DuePush[]) : [];
  } catch (e) {
    console.error("[PushQueue] flush query failed:", e);
    return;
  }
  if (due.length === 0) return;

  await Promise.allSettled(
    due.map(async (row) => {
      const [actorRes, fileRes] = await Promise.all([
        row.last_actor_id
          ? db.from("users").select("username").eq("id", row.last_actor_id).maybeSingle()
          : Promise.resolve({ data: null }),
        row.file_id
          ? db.from("files").select("unique_id").eq("id", row.file_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const actorName = actorRes?.data?.username ?? "Someone";
      const others = Math.max(0, (row.actor_count ?? 1) - 1);

      let url = "/";
      if (row.type === "new_subscriber") {
        url = `/profile/${encodeURIComponent(actorName)}`;
      } else {
        const slug = fileRes?.data?.unique_id;
        url = slug ? `/${slug}` : "/";
        if (slug && row.comment_id) url = `/${slug}?comment=${encodeURIComponent(row.comment_id)}`;
      }

      await sendPushToUser(row.recipient_id, {
        title: "Memories",
        body: coalescedMessage(row.type, actorName, others),
        url,
      });
    }),
  );
}
