import db from "~/lib/Database/supabase";

// Personal "not interested" / "don't recommend creator" preferences. Same
// shape as the report lib  one RPC per verb, errors flattened to short codes.

export type FeedPrefTargetType = "file" | "user";

export interface FeedPrefResult {
  ok: boolean;
  already?: boolean;
  noop?: boolean;
  error?: "invalid" | "invalid_target_type" | "self_target" | "db_error";
}

export async function setFeedPreference(
  userId: string,
  targetType: FeedPrefTargetType,
  targetId: string,
  reason: string | null = null,
): Promise<FeedPrefResult> {
  if (!db) return { ok: false, error: "db_error" };
  try {
    const { data, error } = await db.rpc("set_feed_preference", {
      p_user_id: userId,
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: reason,
    });
    if (error) {
      console.error("[feedpref] set rpc:", error.message ?? error);
      return { ok: false, error: "db_error" };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok === true) return { ok: true, already: r.already === true };
    return { ok: false, error: (r.error as FeedPrefResult["error"]) ?? "invalid" };
  } catch (e) {
    console.error("[feedpref] set threw:", e);
    return { ok: false, error: "db_error" };
  }
}

export async function clearFeedPreference(
  userId: string,
  targetType: FeedPrefTargetType,
  targetId: string,
): Promise<FeedPrefResult> {
  if (!db) return { ok: false, error: "db_error" };
  try {
    const { data, error } = await db.rpc("clear_feed_preference", {
      p_user_id: userId,
      p_target_type: targetType,
      p_target_id: targetId,
    });
    if (error) return { ok: false, error: "db_error" };
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok === true) return { ok: true, noop: r.noop === true };
    return { ok: false, error: (r.error as FeedPrefResult["error"]) ?? "invalid" };
  } catch {
    return { ok: false, error: "db_error" };
  }
}

export interface FeedPrefRow {
  target_type: FeedPrefTargetType;
  target_id: string;
  reason: string | null;
  created_at: string;
}

export async function listFeedPreferences(
  userId: string,
  targetType?: FeedPrefTargetType,
  limit = 50,
  offset = 0,
): Promise<FeedPrefRow[]> {
  if (!db) return [];
  try {
    const { data, error } = await db.rpc("list_feed_preferences", {
      p_user_id: userId,
      p_target_type: targetType ?? null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return [];
    return (data ?? []) as FeedPrefRow[];
  } catch {
    return [];
  }
}
