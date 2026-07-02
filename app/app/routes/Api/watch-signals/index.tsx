import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidUUID } from "~/lib/Security/inputValidation";

/**
 * POST /api/watch-signals - batched positive watch signals from the reel deck
 * (the counterpart to /api/feed-signals, which records negative ones).
 * Body: { items: [{ fileId, ownerId?, categories?, dwellMs? }, ...] }
 *
 * Feeds record_feed_signals, which writes the tables the recommenders read
 * (feed_impressions, user_interest_scores, user_creator_affinity). The user id
 * always comes from the session - a client can only ever train its OWN taste.
 * Fire-and-forget on the client; errors here must never break playback.
 */

const MAX_ITEMS = 50;
const MAX_CATEGORIES = 8;

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) return data({ error: "Unauthorized" }, { status: 401 });
  if (!db) return data({ error: "Database not initialized" }, { status: 500 });

  let body: { items?: unknown };
  try {
    body = (await request.json()) as { items?: unknown };
  } catch {
    return data({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const items = rawItems
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      const fileId = typeof o.fileId === "string" ? o.fileId.trim() : "";
      if (!isValidUUID(fileId)) return null;
      const ownerId =
        typeof o.ownerId === "string" && isValidUUID(o.ownerId.trim()) ? o.ownerId.trim() : null;
      const dwellMs = Number(o.dwellMs);
      const categories = Array.isArray(o.categories)
        ? o.categories
            .filter((c): c is string => typeof c === "string" && c.trim().length > 0 && c.length <= 100)
            .slice(0, MAX_CATEGORIES)
        : [];
      return {
        file_id: fileId,
        owner_id: ownerId,
        categories,
        dwell_ms: Number.isFinite(dwellMs) && dwellMs > 0 ? Math.min(dwellMs, 15 * 60 * 1000) : 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (items.length === 0) return data({ success: true, recorded: 0 }, { status: 200 });

  const { error } = await db.rpc("record_feed_signals", {
    p_user_id: user.id,
    p_items: items,
  });
  if (error) {
    console.error("[watch-signals] rpc:", error.message ?? error);
    return data({ error: "Failed to record" }, { status: 500 });
  }

  return data({ success: true, recorded: items.length }, { status: 200 });
};
