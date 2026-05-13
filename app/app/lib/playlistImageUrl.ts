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
  return u;
}
