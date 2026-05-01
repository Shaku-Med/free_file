import db from "~/lib/Database/supabase";
import type { NotificationType } from "./NotificationService";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

let webpush: typeof import("web-push") | null = null;

async function ensureVapid(): Promise<boolean> {
  if (webpush) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.warn("[Push] VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env");
    return false;
  }
  try {
    const mod = await import("web-push");
    const wp = mod.default ?? mod;
    wp.setVapidDetails("mailto:jujubelt124@gmail.com", publicKey, privateKey);
    webpush = wp;
    console.log("[Push] VAPID configured successfully");
    return true;
  } catch (err) {
    console.error("[Push] Failed to initialize web-push:", err);
    return false;
  }
}

/**
 * Send a push notification to all subscriptions for the given user.
 * Cleans up expired/invalid subscriptions automatically.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!db) {
    console.warn("[Push] Database not available, skipping push");
    return;
  }
  if (!(await ensureVapid()) || !webpush) {
    console.warn("[Push] VAPID not ready, skipping push");
    return;
  }

  const { data: subs, error: subsError } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (subsError) {
    console.error("[Push] Failed to fetch subscriptions for user", userId, subsError.message);
    return;
  }
  if (!subs?.length) {
    console.log("[Push] No subscriptions found for user", userId);
    return;
  }

  const body = JSON.stringify(payload);
  console.log(`[Push] Sending to ${subs.length} subscription(s) for user ${userId}: "${payload.body}"`);

  const results = await Promise.allSettled(
    subs.map((sub: { endpoint: string; p256dh: string; auth: string }) =>
      webpush!.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      )
    )
  );

  // Log results and clean up expired subscriptions
  const expiredEndpoints: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      console.log(`[Push] Sent successfully to subscription ${i + 1}/${subs.length}`);
    } else {
      const err = result.reason;
      const statusCode = err?.statusCode || err?.status;
      console.error(`[Push] Failed to send to subscription ${i + 1}/${subs.length}:`, statusCode, err?.body || err?.message || err);

      // 404 or 410 means the subscription is expired/invalid — remove it
      if (statusCode === 404 || statusCode === 410) {
        expiredEndpoints.push(subs[i].endpoint);
      }
    }
  });

  // Clean up expired subscriptions from DB
  if (expiredEndpoints.length > 0) {
    console.log(`[Push] Cleaning up ${expiredEndpoints.length} expired subscription(s)`);
    await db
      .from("push_subscriptions")
      .delete()
      .in("endpoint", expiredEndpoints)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error("[Push] Failed to clean up expired subs:", error.message);
        else console.log("[Push] Expired subscriptions removed");
      });
  }
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
    case "new_subscriber":
      return `${actorName} subscribed to your channel`;
    default:
      return `${actorName} sent you a notification`;
  }
}

/**
 * Build payload and send push for an in-app notification.
 * Fetches actor username and file unique_id for the link.
 * Skips sending if recipient is the same as the actor (no self-notifications).
 */
export async function sendPushForNotification(
  recipientUserId: string,
  type: NotificationType,
  actorId: string,
  fileId?: string | null,
  commentId?: string | null
): Promise<void> {
  if (!db) return;

  // Don't send push notifications to yourself
  if (recipientUserId === actorId) {
    console.log("[Push] Skipping self-notification for user", actorId);
    return;
  }

  const [userResult, fileResult] = await Promise.all([
    db.from("users").select("username").eq("id", actorId).maybeSingle(),
    fileId ? db.from("files").select("unique_id").eq("id", fileId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const actorName = userResult?.data?.username ?? "Someone";
  let url = "/";
  if (type === "new_subscriber") {
    url = `/profile/${encodeURIComponent(actorName)}`;
  } else {
    const slug = fileResult?.data?.unique_id;
    url = slug ? `/${slug}` : "/";
    if (slug && commentId) {
      url = `/${slug}?comment=${encodeURIComponent(commentId)}`;
    }
  }

  console.log(`[Push] Sending "${type}" notification to user ${recipientUserId} from ${actorName}`);

  await sendPushToUser(recipientUserId, {
    title: "Memories",
    body: getMessage(type, actorName),
    url,
  });
}
