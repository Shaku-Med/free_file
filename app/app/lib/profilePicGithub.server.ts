import { GitHubClient } from "~/lib/Github/GitHubClient";

export function githubRepoForProfile(): string {
  return (typeof process !== "undefined" && process.env.GITHUB_REPO?.trim()) || "Memories";
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
