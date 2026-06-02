import { IMAGE_BASE_URL } from "~/lib/URLS";

/** Same rules as the profilepic loader: no leading slash, single slashes (matches DB / GitHub path). */
export function canonicalProfilePicStoragePath(
  profilePic: string | null | undefined,
): string | undefined {
  if (!profilePic) return undefined;
  const t = profilePic.trim();
  if (!t || t.startsWith("http://") || t.startsWith("https://")) return undefined;
  const collapsed = t
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return collapsed || undefined;
}

/**
 * @param cacheBuster increment after a successful re-upload when the path is unchanged
 * (same file path on GitHub) so the browser fetches the new bytes.
 */
export const getProfilePicUrl = (
  profilePic: string | null | undefined,
  cacheBuster?: number,
): string | undefined => {
  if (!profilePic) {
    return undefined;
  }

  if (profilePic.startsWith("http://") || profilePic.startsWith("https://")) {
    if (cacheBuster != null && cacheBuster > 0) {
      try {
        const u = new URL(profilePic);
        u.searchParams.set("v", String(cacheBuster));
        return u.toString();
      } catch {
        return profilePic;
      }
    }
    return profilePic;
  }

  const rel = canonicalProfilePicStoragePath(profilePic);
  if (!rel) return undefined;

  // Route through LoadNodeServer (the same CDN that serves /api/load/image).
  // Falls back to the same-origin path during SSR if IMAGE_BASE_URL is unset.
  const base = `${IMAGE_BASE_URL || ""}/api/load/profilepic/${rel}`;
  if (cacheBuster != null && cacheBuster > 0) {
    return `${base}?v=${cacheBuster}`;
  }
  return base;
};
