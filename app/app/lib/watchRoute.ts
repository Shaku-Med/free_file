// Top-level single-segment routes that are NOT the Dynamic watch page.
const RESERVED_SEGMENTS = new Set([
  "",
  "privacy",
  "terms",
  "dmca",
  "community-guidelines",
  "brozystudio",
  "api",
  "playlist",
  "tag",
  "pip",
  "search",
  "subscriptions",
  "features",
  "auth",
  "logout",
  "settings",
  "notifications",
  "profile",
  "reel",
  "music",
]);

/** True on the Dynamic watch page (`/:id`) — a single-segment file id. */
export function isWatchRoute(pathname: string): boolean {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 1) return false;
  return !RESERVED_SEGMENTS.has(parts[0]);
}
