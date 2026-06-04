import db from "~/lib/Database/supabase";
import { getMonthlyUploadLimitBytes } from "~/lib/uploadQuota.server";
import { isValidUUID } from "~/lib/Security/inputValidation";

// POST /api/internal/quota-check
// Body: { user_id: uuid, predicted_bytes: number }
// Auth: X-Webhook-Secret == UPLOAD_WEBHOOK_SECRET (same secret the worker uses).
// Returns: { ok, used, limit, remaining, predicted }
//
// Used by the Go upload server to decide whether to enqueue a freshly-assembled
// upload or reject it before the worker burns time on it.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret =
    request.headers.get("X-Webhook-Secret") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  const expected = typeof process !== "undefined" ? process.env?.UPLOAD_WEBHOOK_SECRET : "";
  if (!expected || secret !== expected) return json({ error: "unauthorized" }, 401);

  if (!db) return json({ error: "unavailable" }, 503);

  let body: { user_id?: unknown; predicted_bytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const predictedRaw =
    typeof body.predicted_bytes === "number" ? body.predicted_bytes : Number(body.predicted_bytes);
  const predicted = Number.isFinite(predictedRaw) && predictedRaw > 0 ? Math.floor(predictedRaw) : 0;
  if (!userId || !isValidUUID(userId)) return json({ error: "invalid" }, 400);

  const limit = getMonthlyUploadLimitBytes();
  let used = 0;
  try {
    const { data, error } = await db.rpc("get_monthly_upload_usage", { p_user_id: userId });
    if (!error) {
      const n = typeof data === "number" ? data : Number(data);
      if (Number.isFinite(n) && n >= 0) used = n;
    } else {
      console.warn("[api/internal/quota-check] rpc:", error.message ?? error);
    }
  } catch (e) {
    console.warn("[api/internal/quota-check] threw:", e);
  }

  const remaining = Math.max(limit - used, 0);
  const ok = used + predicted <= limit;
  return json({ ok, used, limit, remaining, predicted });
};

export const loader = () => json({ error: "method not allowed" }, 405);
