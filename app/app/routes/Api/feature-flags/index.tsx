/**
 * Admin surface for feature flags. GET lists every flag with its real settings,
 * POST updates one.
 *
 * This is the kill switch, so it is gated harder than a normal route: the
 * viewer must be signed in AND their id must appear in ADMIN_USER_IDS. That
 * variable is read at request time and, if it is missing or empty, every
 * request is refused. Failing closed matters more here than anywhere else, because
 * a missing env var must never leave the switch that controls every unreleased
 * feature open to whoever asks.
 *
 * Note this returns the full rows including rollout_percent and audience, which
 * the public get_feature_flags() deliberately withholds. That is exactly why it
 * needs its own gate.
 */

import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { invalidateFeatureFlags } from "~/lib/Services/featureFlags.server";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const FLAG_KEY = /^[a-z0-9_]{2,64}$/;
const AUDIENCES = new Set(["everyone", "signed_in", "staff"]);

/** Signed in and listed in ADMIN_USER_IDS. Absent env var denies everyone. */
async function requireAdmin(request: Request): Promise<string | null> {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return null;

  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  if (!user?.id) return null;
  return allowed.includes(String(user.id)) ? String(user.id) : null;
}

export const loader = async ({ request }: { request: Request }) => {
  if (!db) return toJson({ error: "Database not initialized" }, 500);
  // 404, not 403: an admin-only endpoint should not confirm it exists.
  if (!(await requireAdmin(request))) return toJson({ error: "Not found" }, 404);

  const { data, error } = await db
    .from("feature_flags")
    .select("key, description, enabled, rollout_percent, audience, updated_at")
    .order("key");

  if (error) {
    console.error("[feature-flags] list:", error);
    return toJson({ error: "Failed to load flags" }, 500);
  }
  return toJson({ flags: data ?? [], success: true });
};

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return toJson({ error: "Method not allowed" }, 405);
  if (!db) return toJson({ error: "Database not initialized" }, 500);
  const adminId = await requireAdmin(request);
  if (!adminId) return toJson({ error: "Not found" }, 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return toJson({ error: "Invalid JSON" }, 400);
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!FLAG_KEY.test(key)) return toJson({ error: "Invalid key" }, 400);

  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.rollout_percent !== undefined) {
    const n = Number(body.rollout_percent);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return toJson({ error: "rollout_percent must be an integer 0..100" }, 400);
    }
    patch.rollout_percent = n;
  }
  if (body.audience !== undefined) {
    const a = String(body.audience);
    if (!AUDIENCES.has(a)) return toJson({ error: "Invalid audience" }, 400);
    patch.audience = a;
  }
  if (typeof body.description === "string") {
    patch.description = body.description.slice(0, 300);
  }
  if (Object.keys(patch).length === 0) return toJson({ error: "Nothing to update" }, 400);

  // Upsert so a flag can be created from here rather than needing a migration
  // for every new toggle.
  const { error } = await db
    .from("feature_flags")
    .upsert({ key, ...patch }, { onConflict: "key" });

  if (error) {
    console.error("[feature-flags] update:", error);
    return toJson({ error: "Failed to update flag" }, 500);
  }

  // Otherwise the change would not show for up to the cache TTL, which defeats
  // the point of a switch you can flip in a hurry.
  invalidateFeatureFlags();
  console.log(`[feature-flags] ${key} updated by ${adminId}:`, patch);
  return toJson({ success: true });
};
