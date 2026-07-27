/**
 * Mix identity.
 *
 * A mix GID is DERIVED from its seed track, not stored. That's how YouTube's
 * `RD...` list ids work, and it buys three things for free:
 *   - shareable: anyone (signed in or not) opening ?list=RDxxxx resolves the
 *     same seed, so a link always works
 *   - no table, no lifecycle, nothing to garbage-collect
 *   - the CONTENT can still be personalised per viewer while the id stays
 *     stable — same mix, ordered for you
 *
 * Shared by client and server: the feed card builds the href, the API parses
 * it. No secrets here, so it is deliberately not a .server module.
 */

/** Prefix marks the id as a radio/mix list rather than a saved playlist. */
export const MIX_PREFIX = "RD";

/** unique_id charset used across the app. */
const UNIQUE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Build the shareable list id for a seed track. */
export function mixGidFromSeed(seedUniqueId: string): string | null {
  const id = (seedUniqueId ?? "").trim();
  if (!UNIQUE_ID_RE.test(id)) return null;
  return `${MIX_PREFIX}${id}`;
}

/** Recover the seed unique_id from a list id. Null when it isn't a mix gid. */
export function seedFromMixGid(gid: string): string | null {
  const raw = (gid ?? "").trim();
  if (!raw.startsWith(MIX_PREFIX)) return null;
  const seed = raw.slice(MIX_PREFIX.length);
  return UNIQUE_ID_RE.test(seed) ? seed : null;
}

export function isMixGid(gid: string | null | undefined): boolean {
  return typeof gid === "string" && seedFromMixGid(gid) !== null;
}

/**
 * Watch URL for a mix: the FIRST track's page carrying the list.
 * Mirrors YouTube (`/watch?v=<first>&list=<gid>`) — the card points at real
 * playable media, and the list param turns the sidebar into the queue.
 *
 * `startRadio` adds `&start_radio=1`, YouTube's marker for "this list is a
 * radio/mix that should begin playing", as opposed to merely opening a video
 * that happens to belong to a list. Entry points that mean "start the mix"
 * (the feed card, a Mix button) set it; plain in-queue row links do not, so
 * clicking track 7 doesn't re-trigger a fresh radio start.
 */
export function mixWatchPath(
  firstItemUniqueId: string,
  gid: string,
  startRadio = false,
): string {
  const base = `/${encodeURIComponent(firstItemUniqueId)}?list=${encodeURIComponent(gid)}`;
  return startRadio ? `${base}&start_radio=1` : base;
}

/** True when the URL asked for the mix to start playing immediately. */
export function isStartRadio(search: URLSearchParams | string): boolean {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("start_radio") === "1";
}
