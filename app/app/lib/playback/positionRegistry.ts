/**
 * Last known playback position of whatever is currently on screen.
 *
 * Action buttons live all over the tree (watch page, reels, PiP, video cards)
 * and none of them hold a ref to the player. Threading currentTime through every
 * one of them would touch a dozen components, so the player publishes here and
 * the action callers read at the moment they fire.
 *
 * Client only. The value is a hint for ranking, never an authorisation input:
 * the server clamps it against the file's real duration before storing it.
 */

type Snapshot = {
  fileId: string;
  position: number;
  duration: number;
  at: number;
};

let current: Snapshot | null = null;

/** Past this, the player is assumed gone or paused long enough to be unreliable. */
const STALE_MS = 15_000;

export function publishPlaybackPosition(
  fileId: string | null | undefined,
  position: number,
  duration: number,
): void {
  if (!fileId || !Number.isFinite(position) || position < 0) return;
  current = {
    fileId,
    position,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    at: Date.now(),
  };
}

export function clearPlaybackPosition(fileId?: string | null): void {
  if (!fileId || current?.fileId === fileId) current = null;
}

/**
 * Position for `fileId`, or null when nothing reliable is known. Returning null
 * is normal: an action from a feed card with no player open has no position,
 * and the server stores the action without one.
 */
export function readPlaybackPosition(fileId: string | null | undefined): number | null {
  if (!fileId || !current || current.fileId !== fileId) return null;
  if (Date.now() - current.at > STALE_MS) return null;
  return current.position;
}

/** Convenience for request bodies: `{ ...body, ...playbackPositionField(id) }`. */
export function playbackPositionField(fileId: string | null | undefined): { position?: number } {
  const position = readPlaybackPosition(fileId);
  return position === null ? {} : { position: Math.round(position * 1000) / 1000 };
}
