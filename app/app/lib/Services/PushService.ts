import db from "~/lib/Database/supabase";
import type { NotificationType } from "./NotificationService";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

let vapidSet = false;

function ensureVapid(): boolean {
  if (vapidSet) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  try {
    const webpush = require("web-push");
    webpush.setVapidDetails("mailto:noreply@memories.app", publicKey, privateKey);
    vapidSet = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a push notification to all subscriptions for the given user.
 * No-op if VAPID is not configured or user has no subscriptions.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!db || !ensureVapid()) return;

  const { data: subs } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs?.length) return;

  const webpush = require("web-push");
  const body = JSON.stringify(payload);

  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      )
    )
  );
}

function getMessage(type: NotificationType, actorName: string): string {
  switch (type) {
    case "file_like":
      return `${actorName} liked your video`;
    case "file_comment":
      return `${actorName} commented on your video`;
    case "comment_reply":
      return `${actorName} replied to your comment`;
    case "comment_like":
      return `${actorName} liked your comment`;
    case "comment_mention":
      return `${actorName} mentioned you in a comment`;
    default:
      return `${actorName} sent you a notification`;
  }
}

/**
 * Build payload and send push for an in-app notification.
 * Fetches actor username and file unique_id for the link.
 */
export async function sendPushForNotification(
  recipientUserId: string,
  type: NotificationType,
  actorId: string,
  fileId?: string | null
): Promise<void> {
  if (!db) return;

  const [userResult, fileResult] = await Promise.all([
    db.from("users").select("username").eq("id", actorId).maybeSingle(),
    fileId ? db.from("files").select("unique_id").eq("id", fileId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const actorName = userResult?.data?.username ?? "Someone";
  const url = fileResult?.data?.unique_id ? `/${fileResult.data.unique_id}` : "/";

  await sendPushToUser(recipientUserId, {
    title: "Memories",
    body: getMessage(type, actorName),
    url,
  });
}
