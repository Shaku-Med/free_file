/** Client-side LoadPlay CDN detection (mirrors server origins). */

const LOADPLAY_HOSTS = new Set([
  "localhost:3006",
  "127.0.0.1:3006",
  "cdn.memories.brozy.org",
]);

/** True when playback should use the signed `?t=` token only — no app cookies. */
export function isLoadplayPlaybackUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : "http://localhost");
    if (LOADPLAY_HOSTS.has(u.host.toLowerCase())) return true;
    return u.pathname.startsWith("/v/") && u.search.includes("t=");
  } catch {
    return url.includes("/v/") && url.includes("?t=");
  }
}
