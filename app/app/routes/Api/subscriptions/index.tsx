import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { createNotification } from "~/lib/Services/NotificationService";
import { sendPushForNotification } from "~/lib/Services/PushService";

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
    sendPushForNotification(channelId, "new_subscriber", subscriberId, null, null).catch((e) =>
      console.error("[Push] new_subscriber failed:", e)
    );
  })();
}

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
      if (shouldNotifyNewSubscription("toggle", obj)) {
        fireNewSubscriberNotifications(channel_id, user.id);
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

      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return data(parsed, { status: 200 });
    }

    return data({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Subscription API error:", error);
    return data({ success: false, error: "Internal server error" }, { status: 500 });
  }
};
