import { GitHubClient } from "~/lib/Github/GitHubClient";
import { validGitHubRepoName } from "~/lib/profilePicSecurity.server";

export function githubRepoForProfile(): string {
  const env = (typeof process !== "undefined" && process.env.GITHUB_REPO?.trim()) || "Memories";
  return validGitHubRepoName(env) ? env : "Memories";
}

/** Repo where the user's current profile picture file lives (matches Go upload target). */
export function githubRepoForProfilePath(userGithubRepo: string | null | undefined): string {
  const t = typeof userGithubRepo === "string" ? userGithubRepo.trim() : "";
  if (t && validGitHubRepoName(t)) return t;
  return githubRepoForProfile();
}

export async function deleteOldProfilePicIfNeeded(
  githubClient: GitHubClient,
  currentProfilePic: string | null | undefined,
  newPath: string,
  username: string,
) {
  if (!currentProfilePic) return;
  let oldPath: string | null = null;
  if (currentProfilePic.includes("raw.githubusercontent.com")) {
    const urlMatch = currentProfilePic.match(/\/main\/(.+)$/);
    if (urlMatch?.[1]) oldPath = urlMatch[1];
  } else {
    oldPath = currentProfilePic;
  }
  if (!oldPath || oldPath === newPath) return;
  const oldSha = await githubClient.getFileSha(oldPath);
  if (oldSha) {
    try {
      await githubClient.deleteFile(oldPath, `Update profile picture for ${username}`);
    } catch {
      /* best-effort */
    }
  }
}
