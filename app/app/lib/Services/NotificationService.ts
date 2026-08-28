import db from "~/lib/Database/supabase";

/** Default: notifications expire after this many days (for cron cleanup). */
export const NOTIFICATION_EXPIRY_DAYS = 90;

export type NotificationType =
  | "file_like"
  | "file_comment"
  | "comment_reply"
  | "comment_like"
  | "comment_mention"
  | "new_subscriber"
  // System notifications about the viewer's own upload. Written by
  // uploadNotifications.server, which bypasses the self-notify guard below.
  | "upload_ready"
  | "upload_failed";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  actorId: string;
  fileId?: string | null;
  commentId?: string | null;
}

function getExpiresAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + NOTIFICATION_EXPIRY_DAYS);
  return d.toISOString();
}

/**
 * Create a notification. Skips if recipient is the same as actor (no self-notify).
 * Sets expires_at for cron cleanup.
 */
export async function createNotification(input: CreateNotificationInput): Promise<{ error: string | null }> {
  if (!db) return { error: "Database not initialized" };
  if (input.userId === input.actorId) return { error: null };

  const { error } = await db.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    actor_id: input.actorId,
    file_id: input.fileId ?? null,
    comment_id: input.commentId ?? null,
    expires_at: getExpiresAt(),
  });

  if (error) {
    console.error("createNotification error:", error);
    return { error: error.message };
  }
  return { error: null };
}
