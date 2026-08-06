import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { createNotification } from "~/lib/Services/NotificationService";
import { enqueuePush, cancelPush } from "~/lib/Services/PushQueue.server";
import { isValidUUID } from "~/lib/Security/inputValidation";
import { parsePlaybackPosition, recordActionPosition } from "~/lib/Services/actionPosition.server";

function shouldNotifyNewSubscription(
  actionType: string,
  parsed: Record<string, unknown>
): boolean {
  if (parsed.success !== true) return false;
  if (actionType === "toggle") return parsed.subscribed === true;
  if (actionType === "subscribe") {
    return parsed.already_subscribed !== true && parsed.subscription_id != null;
  }
  return false;
}

function fireNewSubscriberNotifications(channelId: string, subscriberId: string) {
  void (async () => {
    const { error } = await createNotification({
      userId: channelId,
      type: "new_subscriber",
      actorId: subscriberId,
    });
    if (error) console.error("new_subscriber notification:", error);
    void enqueuePush(channelId, "new_subscriber", subscriberId, null, null);
  })();
}

/**
 * GET /api/subscriptions?channel_id=… — is the current viewer subscribed to this channel?
 * Reuses the same `get_channel_stats` RPC the profile page uses (returns `is_subscribed`),
 * so reels can hide the Subscribe button for channels you already follow without threading
 * subscription state through the whole feed.
 */
export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const channelId = url.searchParams.get("channel_id");
    if (!channelId) {
      return data({ success: false }, { status: 400 });
    }
    if (!db) {
      return data({ success: false }, { status: 500 });
    }

    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) {
      return data({ success: false }, { status: 401 });
    }

    const { data: statsResult } = await db.rpc("get_channel_stats", {
      p_user_id: channelId,
      p_viewer_id: user.id,
    });
    const parsed =
      typeof statsResult === "string" ? JSON.parse(statsResult) : statsResult;

    return data(
      {
        success: true,
        subscribed: Boolean(parsed?.is_subscribed),
        subscriber_count: Number(parsed?.subscriber_count) || 0,
      },
      { status: 200 },
    );
  } catch {
    return data({ success: false, error: "Internal server error" }, { status: 500 });
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") {
      return data({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) {
      return data({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!db) {
      return data({ success: false, error: "Database unavailable" }, { status: 500 });
    }

    const body = await request.json();
    const { channel_id, action: actionType } = body;

    if (!channel_id) {
      return data({ success: false, error: "channel_id is required" }, { status: 400 });
    }

    // The file being watched when the subscribe happened. Optional, and only
    // counted when it actually belongs to this channel.
    const contextFileId: string | null =
      typeof body?.fileId === "string" && isValidUUID(body.fileId) ? body.fileId : null;
    const contextPosition = parsePlaybackPosition(body?.position);
    const trackSubscribe = (subscribed: boolean) => {
      if (!contextFileId) return;
      void recordActionPosition(
        user.id, contextFileId, "subscribe", contextPosition, subscribed, channel_id,
      );
    };

    if (actionType === "toggle") {
      const { data: result, error } = await db.rpc("toggle_subscription", {
        p_subscriber_id: user.id,
        p_channel_id: channel_id,
      });

      if (error) {
        console.error("toggle_subscription error:", error);
        return data({ success: false, error: "Failed to toggle subscription" }, { status: 500 });
      }

      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      const obj = parsed as Record<string, unknown>;
      trackSubscribe(obj.subscribed === true);
      if (shouldNotifyNewSubscription("toggle", obj)) {
        fireNewSubscriberNotifications(channel_id, user.id);
      } else if (obj.success === true && obj.subscribed === false) {
        // Unsubscribed: cancel any pending new-subscriber push.
        void cancelPush(channel_id, "new_subscriber", user.id);
      }
      return data(parsed, { status: 200 });
    }

    if (actionType === "toggle_notify") {
      const { data: result, error } = await db.rpc("toggle_subscription_notify", {
        p_subscriber_id: user.id,
        p_channel_id: channel_id,
      });

      if (error) {
        console.error("toggle_subscription_notify error:", error);
        return data({ success: false, error: "Failed to toggle notifications" }, { status: 500 });
      }

      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return data(parsed, { status: 200 });
    }

    if (actionType === "subscribe") {
      const { data: result, error } = await db.rpc("subscribe", {
        p_subscriber_id: user.id,
        p_channel_id: channel_id,
      });

      if (error) {
        return data({ success: false, error: "Failed to subscribe" }, { status: 500 });
      }

      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      const obj = parsed as Record<string, unknown>;
      trackSubscribe(true);
      if (shouldNotifyNewSubscription("subscribe", obj)) {
        fireNewSubscriberNotifications(channel_id, user.id);
      }
      return data(parsed, { status: 200 });
    }

    if (actionType === "unsubscribe") {
      const { data: result, error } = await db.rpc("unsubscribe", {
        p_subscriber_id: user.id,
        p_channel_id: channel_id,
      });

      if (error) {
        return data({ success: false, error: "Failed to unsubscribe" }, { status: 500 });
      }

      // Cancel any pending new-subscriber push from a just-undone subscribe.
      void cancelPush(channel_id, "new_subscriber", user.id);
      trackSubscribe(false);
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return data(parsed, { status: 200 });
    }

    return data({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Subscription API error:", error);
    return data({ success: false, error: "Internal server error" }, { status: 500 });
  }
};
