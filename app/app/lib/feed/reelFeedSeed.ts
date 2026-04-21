/** Strong unique seed for `get_reel_feed` so each request reshuffles among non-excluded reels. */
export function newReelFeedSeed(): string {
  const extra =
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Math.random().toString(36).slice(2, 14)}${typeof performance !== "undefined" ? performance.now() : ""}`;
  return `${Date.now()}-${extra}`;
}
