/** When set, `/reel/:uniqueId/:username` queues that creator's reels before the global feed. */
export type ReelProfileContext = {
  userId: string;
  username: string;
};

export type ReelWatchPathOptions = {
  /** Profile page links pass the channel username so swipes stay on that creator first. */
  profileOwnerUsername?: string | null;
};

export function buildReelWatchPath(
  uniqueId: string,
  profileOwnerUsername?: string | null,
): string {
  const slug = encodeURIComponent(String(uniqueId));
  const owner = profileOwnerUsername?.trim();
  if (owner) {
    return `/reel/${slug}/${encodeURIComponent(owner)}`;
  }
  return `/reel/${slug}`;
}

export function usernamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
