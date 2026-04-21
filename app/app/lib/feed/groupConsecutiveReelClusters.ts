import type { FileType } from "~/lib/types";

export type FeedRenderGroup =
  | { kind: "single"; file: FileType }
  | { kind: "reelGroup"; files: FileType[] };

/**
 * Turns a flat feed page (from get_feed / etc.) into singles vs horizontal reel strips.
 * Rows with the same `feed_reel_cluster_id` and `is_reel` that appear back-to-back are one group.
 */
export function groupConsecutiveReelClusters(files: FileType[]): FeedRenderGroup[] {
  const out: FeedRenderGroup[] = [];
  let i = 0;
  while (i < files.length) {
    const f = files[i];
    const cid = f.feed_reel_cluster_id;
    if (f.is_reel && cid != null && Number.isFinite(Number(cid))) {
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
    out.push({ kind: "single", file: f });
    i++;
  }
  return out;
}
