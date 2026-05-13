import type { FileType } from "~/lib/types";

export type FeedRenderGroup =
  | { kind: "single"; file: FileType }
  | { kind: "reelGroup"; files: FileType[] };

function hasNumericClusterId(cid: unknown): boolean {
  return cid != null && Number.isFinite(Number(cid));
}

/**
 * Turns a flat feed or profile page into singles vs horizontal reel strips.
 *
 * 1. **Feed / search**: same `feed_reel_cluster_id` on consecutive `is_reel` rows → one horizontal strip.
 * 2. **Profile (and any list without cluster ids)**: consecutive `is_reel` rows with **no** cluster id
 *    also form a strip, so uploads / liked / history match the home feed behavior.
 */
export function groupConsecutiveReelClusters(files: FileType[]): FeedRenderGroup[] {
  const out: FeedRenderGroup[] = [];
  let i = 0;
  while (i < files.length) {
    const f = files[i];
    const cid = f.feed_reel_cluster_id;

    if (f.is_reel && hasNumericClusterId(cid)) {
      const run: FileType[] = [f];
      let j = i + 1;
      while (
        j < files.length &&
        files[j].is_reel &&
        files[j].feed_reel_cluster_id === cid
      ) {
        run.push(files[j]);
        j++;
      }
      if (run.length > 1) {
        out.push({ kind: "reelGroup", files: run });
        i = j;
        continue;
      }
    }

    if (f.is_reel && !hasNumericClusterId(cid)) {
      const run: FileType[] = [f];
      let j = i + 1;
      while (
        j < files.length &&
        files[j].is_reel &&
        !hasNumericClusterId(files[j].feed_reel_cluster_id)
      ) {
        run.push(files[j]);
        j++;
      }
      if (run.length > 1) {
        out.push({ kind: "reelGroup", files: run });
        i = j;
        continue;
      }
    }

    out.push({ kind: "single", file: f });
    i++;
  }
  return out;
}
