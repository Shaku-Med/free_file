import type { FileType } from "~/lib/types";
import { REEL_STRIP_BATCH_SIZE } from "./groupConsecutiveReelClusters";

export type ProfileTabRenderGroup = {
  label: string;
  files: FileType[];
  variant: "shorts" | "videos" | "series";
};

function isSeriesFile(f: FileType): boolean {
  return Boolean(f.is_series_main || f.is_files_series_item || f.is_series_episode);
}

function seriesLabel(files: FileType[]): string {
  const main = files.find((f) => f.is_series_main);
  const titled = main?.file_title || main?.filename;
  if (titled) return titled;
  const first = files[0];
  return first?.file_title || first?.filename || "Series";
}

function pushGroup(out: ProfileTabRenderGroup[], group: ProfileTabRenderGroup) {
  if (group.files.length === 0) return;

  const prev = out[out.length - 1];
  if (
    prev &&
    prev.variant === group.variant &&
    prev.label === group.label &&
    (group.variant === "shorts" || group.variant === "videos")
  ) {
    prev.files.push(...group.files);
    return;
  }

  if (
    prev &&
    prev.variant === "series" &&
    group.variant === "series" &&
    prev.files[0]?.file_series_id &&
    prev.files[0].file_series_id === group.files[0]?.file_series_id
  ) {
    prev.files.push(...group.files);
    return;
  }

  out.push({ ...group, files: [...group.files] });
}

/**
 * Profile tab / See-all grids: reel strips, series runs, and regular videos as
 * labeled blocks (Shorts, Series title, Videos) — same idea as channel home rows.
 */
export function groupProfileTabItems(files: FileType[]): ProfileTabRenderGroup[] {
  const out: ProfileTabRenderGroup[] = [];
  const usedReelIdx = new Set<number>();
  let i = 0;

  while (i < files.length) {
    const f = files[i];

    if (f.is_reel) {
      if (usedReelIdx.has(i)) {
        i++;
        continue;
      }

      const run: FileType[] = [f];
      usedReelIdx.add(i);
      let j = i + 1;
      while (run.length < REEL_STRIP_BATCH_SIZE && j < files.length) {
        if (usedReelIdx.has(j)) {
          j++;
          continue;
        }
        const next = files[j];
        if (next.is_reel) {
          run.push(next);
          usedReelIdx.add(j);
        }
        j++;
      }

      pushGroup(out, { label: "Shorts", files: run, variant: "shorts" });
      i++;
      continue;
    }

    if (isSeriesFile(f) && f.file_series_id) {
      const sid = f.file_series_id;
      const run: FileType[] = [];
      let j = i;
      while (
        j < files.length &&
        isSeriesFile(files[j]) &&
        files[j].file_series_id === sid
      ) {
        run.push(files[j]);
        j++;
      }
      pushGroup(out, { label: seriesLabel(run), files: run, variant: "series" });
      i = j;
      continue;
    }

    const run: FileType[] = [];
    let j = i;
    while (
      j < files.length &&
      !files[j].is_reel &&
      !(isSeriesFile(files[j]) && files[j].file_series_id)
    ) {
      run.push(files[j]);
      j++;
    }
    pushGroup(out, { label: "Videos", files: run, variant: "videos" });
    i = j;
  }

  return out;
}
