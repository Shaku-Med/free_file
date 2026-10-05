import { data } from "react-router";
import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";

const SIDEBAR_CHANNEL_LIMIT = 50;

type ChannelRow = {
  channel: { username: string | null; profile_pic: string | null; verified: boolean | null } | null;
};

/**
 * GET /api/subscriptions/channels: the channels the signed in viewer follows,
 * newest first, for the sidebar. Only what the list draws is returned, never
 * an id.
 */
export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) return data({ channels: [] }, { status: 401 });
  if (!db) return data({ channels: [] }, { status: 503 });

  const { data: rows, error } = await db
    .from("subscriptions")
    .select("channel:users!subscriptions_channel_fkey(username, profile_pic, verified)")
    .eq("subscriber_id", user.id)
    .order("created_at", { ascending: false })
    .limit(SIDEBAR_CHANNEL_LIMIT);

  if (error) {
    console.error("subscriptions/channels:", error);
    return data({ channels: [] }, { status: 500 });
  }

  const channels = ((rows ?? []) as unknown as ChannelRow[])
    .map((row) => row.channel)
    .filter((c): c is NonNullable<ChannelRow["channel"]> => Boolean(c?.username))
    .map((c) => ({ username: c.username as string, profile_pic: c.profile_pic, verified: c.verified === true }));

  return data({ channels }, { headers: { "Cache-Control": "private, no-store" } });
};
