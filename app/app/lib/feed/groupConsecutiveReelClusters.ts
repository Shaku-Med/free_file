import type { FileType } from "~/lib/types";

export type FeedRenderGroup =
  | { kind: "single"; file: FileType }
  | { kind: "reelGroup"; files: FileType[] };

/** Target reels per horizontal Shorts strip (gathers forward, skipping non-reels). */
export const REEL_STRIP_BATCH_SIZE = 5;

/** True when `next` continues the shelf that `prev` belongs to. */
export function inSameReelShelf(prev: FileType | undefined, next: FileType): boolean {
  return Boolean(
    prev?.is_reel &&
      next.is_reel &&
      next.feed_reel_cluster_id != null &&
      prev.feed_reel_cluster_id === next.feed_reel_cluster_id,
  );
}

/**
 * For lists the database already shelved (home feed, related): shorts sitting
 * next to each other with the same feed_reel_cluster_id share a strip. Nothing
 * moves, so the screen shows the ranked order and a new page never changes a
 * strip that is already on screen.
 */
export function groupReelShelves(files: FileType[]): FeedRenderGroup[] {
  // Served by the old functions (taste_vector_recommendations.sql not run yet).
  if (files.some((f) => f.is_reel && f.feed_reel_cluster_id == null)) {
    return groupConsecutiveReelClusters(files);
  }
  const out: FeedRenderGroup[] = [];
  for (const file of files) {
    const prev = out[out.length - 1];
    if (prev?.kind === "reelGroup" && inSameReelShelf(prev.files[prev.files.length - 1], file)) {
      prev.files.push(file);
    } else if (file.is_reel) {
      out.push({ kind: "reelGroup", files: [file] });
    } else {
      out.push({ kind: "single", file });
    }
  }
  return out;
}

/**
 * For lists the database does not shelve (subscriptions, profile, saved).
 *
 * When a reel is encountered, scan forward through the rest of the list and
 * collect up to {@link REEL_STRIP_BATCH_SIZE} reels for one strip — even if
 * regular videos sit between them (the feed often interleaves). Each reel is
 * only placed in one strip.
 */
export function groupConsecutiveReelClusters(files: FileType[]): FeedRenderGroup[] {
  const out: FeedRenderGroup[] = [];
  const used = new Set<number>();

  let i = 0;
  while (i < files.length) {
    if (used.has(i)) {
      i++;
      continue;
    }

    const f = files[i];
    if (!f.is_reel) {
      out.push({ kind: "single", file: f });
      i++;
      continue;
    }

    const run: FileType[] = [f];
    used.add(i);

    let j = i + 1;
    while (run.length < REEL_STRIP_BATCH_SIZE && j < files.length) {
      if (used.has(j)) {
        j++;
        continue;
      }
      const next = files[j];
      if (next.is_reel) {
        run.push(next);
        used.add(j);
      }
      j++;
    }

    out.push({ kind: "reelGroup", files: run });
    i++;
  }

  return out;
}
