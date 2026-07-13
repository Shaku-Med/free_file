import type { FileType } from "~/lib/types";

export type FeedRenderGroup =
  | { kind: "single"; file: FileType }
  | { kind: "reelGroup"; files: FileType[] };

/**
 * Turns a flat feed or profile page into singles vs horizontal reel strips.
 *
 * Any run of consecutive `is_reel` rows becomes one horizontal strip  including
 * a lone reel, which still gets its own strip rather than leaking into the grid.
 * Directly adjacent reels merge into a single strip regardless of
 * `feed_reel_cluster_id`, so we never stack two "Shorts" headers back to back.
 * Non-reel rows between reels keep the strips separate on their own.
 */
export function groupConsecutiveReelClusters(files: FileType[]): FeedRenderGroup[] {
  const out: FeedRenderGroup[] = [];
  let i = 0;
  while (i < files.length) {
    const f = files[i];

    if (f.is_reel) {
      const run: FileType[] = [f];
      let j = i + 1;
      while (j < files.length && files[j].is_reel) {
        run.push(files[j]);
        j++;
      }
      out.push({ kind: "reelGroup", files: run });
      i = j;
      continue;
    }

    out.push({ kind: "single", file: f });
    i++;
  }
  return out;
}
