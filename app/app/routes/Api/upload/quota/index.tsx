import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { getMonthlyUploadLimitBytes } from "~/lib/uploadQuota.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

// GET /api/upload/quota  the signed-in user's rolling 30-day upload usage.
export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const userId = user && typeof user !== "boolean" ? user.id : null;
  if (!userId) return json({ error: "unauthorized" }, 401);
  if (!db) return json({ error: "unavailable" }, 503);

  const limit = getMonthlyUploadLimitBytes();
  let used = 0;
  try {
    const { data, error } = await db.rpc("get_monthly_upload_usage", { p_user_id: userId });
    if (!error) {
      const n = typeof data === "number" ? data : Number(data);
      if (Number.isFinite(n) && n >= 0) used = n;
    } else {
      console.warn("[api/upload/quota] rpc:", error.message ?? error);
    }
  } catch (e) {
    console.warn("[api/upload/quota] threw:", e);
  }

  const remaining = Math.max(limit - used, 0);
  return json({ used, limit, remaining, windowDays: 30 });
};
