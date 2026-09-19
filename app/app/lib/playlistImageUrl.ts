import { IMAGE_BASE_URL } from "~/lib/URLS";

/** Playlist thumbnails from RPCs are often site relative paths. */
export function resolvePlaylistThumbSrc(
  url: string | null | undefined
): string | null {
  if (!url || typeof url !== "string") return null;
  const u = url.trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${IMAGE_BASE_URL}${u}`;
  // Anything else is a bare storage path. Reject values carrying a scheme so a
  // stored javascript: or data: string can never reach an src attribute.
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null;
  return u;
}
