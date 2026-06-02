import { isAuthenticated } from "~/lib/Security/Password";
import {
  setFeedPreference,
  clearFeedPreference,
  listFeedPreferences,
  type FeedPrefTargetType,
} from "~/lib/feedPreferences.server";
import { isValidUUID } from "~/lib/Security/inputValidation";

const TARGETS = new Set<FeedPrefTargetType>(["file", "user"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// GET /api/feed-preferences[?target_type=file|user]  list this user's hides.
export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const userId = user && typeof user !== "boolean" ? user.id : null;
  if (!userId || !isValidUUID(userId)) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const tt = url.searchParams.get("target_type") as FeedPrefTargetType | null;
  const filter = tt && TARGETS.has(tt) ? tt : undefined;
  const items = await listFeedPreferences(userId, filter, 100, 0);
  return json({ items });
};

// POST /api/feed-preferences        body: { target_type, target_id, reason? }
// DELETE /api/feed-preferences      body: { target_type, target_id }
export const action = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const userId = user && typeof user !== "boolean" ? user.id : null;
  if (!userId || !isValidUUID(userId)) return json({ error: "unauthorized" }, 401);

  let body: { target_type?: unknown; target_id?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const targetType = body.target_type as FeedPrefTargetType | undefined;
  const targetId = typeof body.target_id === "string" ? body.target_id.trim() : "";
  if (!targetType || !TARGETS.has(targetType)) return json({ error: "invalid_target_type" }, 400);
  if (!targetId || targetId.length > 128) return json({ error: "invalid_target" }, 400);

  if (request.method === "POST") {
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 80) || null : null;
    const result = await setFeedPreference(userId, targetType, targetId, reason);
    if (!result.ok) {
      if (result.error === "self_target") return json({ error: result.error }, 403);
      return json({ error: result.error ?? "invalid" }, 400);
    }
    return json({ ok: true, already: result.already === true });
  }

  if (request.method === "DELETE") {
    const result = await clearFeedPreference(userId, targetType, targetId);
    if (!result.ok) return json({ error: result.error ?? "invalid" }, 400);
    return json({ ok: true, noop: result.noop === true });
  }

  return json({ error: "method_not_allowed" }, 405);
};
