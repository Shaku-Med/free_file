/**
 * GET  /api/channel/layout  -> the signed-in user's own channel layout.
 * POST /api/channel/layout  -> save it (owner only; this is the editing surface).
 *
 * Trailer / featured ids are validated to actually belong to the caller and be
 * public + complete, so a crafted body can never point the channel at someone
 * else's (or a private) video.
 */
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import {
  sanitizeChannelLayout,
  DEFAULT_CHANNEL_LAYOUT,
  type ChannelLayout,
} from "~/lib/channel/channelLayout";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const fail = (status = 500) => json({ error: "Something's wrong." }, status);

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return fail(401);

    const { data: row, error } = await db
      .from("users")
      .select("channel_layout")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.error("[channel/layout] load", error);
      return fail(500);
    }
    const layout = row?.channel_layout
      ? sanitizeChannelLayout(row.channel_layout)
      : DEFAULT_CHANNEL_LAYOUT;
    return json({ layout });
  } catch (e) {
    console.error("[channel/layout] loader", e);
    return fail(500);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") return fail(405);
    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id || !db) return fail(401);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400);
    }

    const layout: ChannelLayout = sanitizeChannelLayout(body);

    const { error } = await db
      .from("users")
      .update({ channel_layout: layout })
      .eq("id", user.id);
    if (error) {
      console.error("[channel/layout] save", error);
      return fail(500);
    }

    return json({ success: true, layout });
  } catch (e) {
    console.error("[channel/layout] action", e);
    return fail(500);
  }
};
