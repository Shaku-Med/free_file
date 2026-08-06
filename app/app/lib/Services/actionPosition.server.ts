/**
 * Records how far into playback a viewer was when they acted on a file.
 *
 * The position arrives from the browser and is treated as a hint, never as
 * fact. `record_action_position` clamps it against the file's real duration and
 * derives the ratio in SQL, so the worst a forged payload achieves is claiming
 * a position somewhere inside a video the sender is already allowed to act on.
 */

import db from "~/lib/Database/supabase";

export type TrackedAction = "like" | "dislike" | "save" | "subscribe";

const TRACKED_ACTIONS: ReadonlySet<string> = new Set([
  "like",
  "dislike",
  "save",
  "subscribe",
]);

/** Longer than any file the pipeline accepts; anything past it is a bad payload. */
const MAX_POSITION_SECONDS = 86_400;

/** Returns a usable position, or null when absent or malformed. Absent is normal. */
export function parsePlaybackPosition(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_POSITION_SECONDS) return null;
  return n;
}

/**
 * Fire and forget. Ranking metadata must never fail a user's action, so every
 * error is swallowed after logging.
 */
export async function recordActionPosition(
  userId: string,
  fileId: string,
  action: TrackedAction,
  position: number | null,
  active: boolean,
  /** Subscribe only: the file must belong to this channel or nothing is stored. */
  requireOwnerId?: string | null,
): Promise<void> {
  if (!db || !userId || !fileId || !TRACKED_ACTIONS.has(action)) return;
  // Nothing to store for a first-time action with no player open, but an undone
  // action still has to clear the old row.
  if (position === null && active) return;

  try {
    const { error } = await db.rpc("record_action_position", {
      p_user_id: userId,
      p_file_id: fileId,
      p_action: action,
      p_position: position ?? 0,
      p_active: active,
      p_require_owner: requireOwnerId ?? null,
    });
    if (error) console.warn("[actionPosition]", action, error.message);
  } catch (e) {
    console.warn("[actionPosition]", action, e);
  }
}
