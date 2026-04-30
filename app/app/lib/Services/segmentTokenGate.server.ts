import { sessionScope } from "./SegmentTokenService";

/**
 * Per-segment-token consumption gate.
 *
 * Each `_st` may be redeemed at most {@link MAX_USES} times within {@link RETRY_WINDOW_MS}
 * of its first use. After that the token is dead — even if its HMAC + expiry are still
 * structurally valid, this gate rejects it.
 *
 * Why not single-use:
 *   HLS.js retries segments on transient network errors and re-fetches when the user
 *   seeks backward beyond the in-memory buffer. Strict 1-use would break those flows.
 *   {@link MAX_USES}=5 covers normal retry/seek; an extension trying to bulk-download
 *   each segment after legitimate playback is rejected on the 6th hit (or after the
 *   window closes), so replay attacks are bounded to a small constant per token.
 *
 * Why bind to {@link sessionScope}:
 *   The scope is HMAC-derived from the session cookie. A stolen URL can't share a gate
 *   entry with the original session's player, so an attacker reusing a leaked token
 *   has its own (empty) bucket — but they still need a valid cookie too, which the
 *   token's own HMAC requires.
 */

/** Max redemptions of a single `_st`. 1 first use + 4 retries is enough for legit playback. */
const MAX_USES = 5;
/** First-use → spent window. Exhaust the budget after this regardless of `uses`. */
const RETRY_WINDOW_MS = 5 * 60 * 1000;
/** How long to remember a spent token so replays after the window are still rejected. */
const REPLAY_BLOCK_MS = 60 * 60 * 1000;

const SWEEP_EVERY_MS = 120_000;

type Entry = {
  firstUsedAt: number;
  uses: number;
};

const used = new Map<string, Entry>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of used) {
    if (now - v.firstUsedAt > REPLAY_BLOCK_MS) used.delete(k);
  }
}

if (typeof setInterval !== "undefined") {
  setInterval(sweep, SWEEP_EVERY_MS);
}

/**
 * Returns `true` on first use or within the retry tolerance; `false` once the token
 * has been spent past {@link MAX_USES} or the {@link RETRY_WINDOW_MS} has elapsed.
 *
 * Caller MUST verify the token's HMAC first — this gate trusts that step and only
 * tracks consumption. It is never a substitute for `verifySegmentToken`.
 */
export function trySpendSegmentToken(
  token: string,
  segmentPath: string,
  headers: Headers,
): boolean {
  const key = `${sessionScope(headers)}|${segmentPath}|${token}`;
  const now = Date.now();
  const entry = used.get(key);
  if (!entry) {
    used.set(key, { firstUsedAt: now, uses: 1 });
    return true;
  }
  if (now - entry.firstUsedAt > RETRY_WINDOW_MS) return false;
  if (entry.uses >= MAX_USES) return false;
  entry.uses += 1;
  return true;
}
