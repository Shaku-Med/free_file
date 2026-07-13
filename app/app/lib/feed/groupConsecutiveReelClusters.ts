import type { FileType } from "~/lib/types";

export type FeedRenderGroup =
  | { kind: "single"; file: FileType }
  | { kind: "reelGroup"; files: FileType[] };

/** Target reels per horizontal Shorts strip (gathers forward, skipping non-reels). */
export const REEL_STRIP_BATCH_SIZE = 5;

/**
 * Turns a flat feed into singles vs horizontal reel strips.
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
