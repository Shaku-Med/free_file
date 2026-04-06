/** Conservative GitHub repo segment — must match Go `supabase.ValidGitHubRepoName`. */
const REPO_NAME = /^[a-zA-Z0-9._-]{1,100}$/;

export function validGitHubRepoName(name: string | null | undefined): boolean {
  if (name == null || typeof name !== "string") return false;
  return REPO_NAME.test(name.trim());
}

const PROFILE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

/**
 * Ensures Go-returned path is exactly `{username}/{userId}.{ext}` for the authenticated user
 * (mitigates a compromised/malicious upload service returning another user's object key).
 */
export function isProfilePicPathForUser(
  path: string,
  username: string,
  userId: string,
): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  const m = /^([^/]+)\/([^/]+)\.([a-zA-Z0-9]+)$/.exec(normalized);
  if (!m) return false;
  const [, segUser, segId, ext] = m;
  if (!PROFILE_EXT.has(ext.toLowerCase())) return false;
  if (segUser !== username) return false;
  return segId.toLowerCase() === userId.toLowerCase();
}
