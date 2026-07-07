/**
 * Parse YouTube-style chapter markers from a video description.
 *
 * A line qualifies when it starts with a timestamp (`m:ss`, `mm:ss`, or
 * `h:mm:ss`), optionally wrapped in brackets or followed by a dash, e.g.
 *   0:00 Intro
 *   1:24 - The build
 *   [12:03] Results
 *
 * Rules (match YouTube so we only show real chapter lists, never noise):
 *   - at least 3 markers
 *   - the first must be at 0:00
 *   - strictly increasing and inside the video duration
 * Anything else returns [] so a stray "call me at 5:30" never makes chapters.
 */
export interface Chapter {
  start: number;
  title: string;
}

const LINE_RE =
  /^\s*\[?\(?\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*\)?\]?\s*[-–—:.)]?\s*(.*\S)?\s*$/;

const MAX_TITLE = 120;

function toSeconds(a: number, b: number, c?: number): number {
  return c != null ? a * 3600 + b * 60 + c : a * 60 + b;
}

export function parseChapters(
  description: string | null | undefined,
  duration: number,
): Chapter[] {
  if (!description || !Number.isFinite(duration) || duration <= 0) return [];

  const found: Chapter[] = [];
  for (const rawLine of description.split(/\r?\n/)) {
    const m = LINE_RE.exec(rawLine);
    if (!m) continue;
    const h = m[3] != null ? Number(m[1]) : undefined;
    const min = m[3] != null ? Number(m[2]) : Number(m[1]);
    const sec = m[3] != null ? Number(m[3]) : Number(m[2]);
    if (min > 59 || sec > 59) continue;
    const start = h != null ? toSeconds(h, min, sec) : toSeconds(min, sec);
    if (start > duration) continue;
    const title = (m[4] ?? '').trim().slice(0, MAX_TITLE);
    if (!title) continue;
    found.push({ start, title });
  }

  if (found.length < 3) return [];
  found.sort((a, b) => a.start - b.start);
  if (found[0].start !== 0) return [];

  // Reject anything not strictly increasing (dupes / out-of-order noise).
  for (let i = 1; i < found.length; i++) {
    if (found[i].start <= found[i - 1].start) return [];
  }
  return found;
}

/** Index of the chapter covering `time`, or -1. Chapters must be sorted. */
export function activeChapterIndex(chapters: Chapter[], time: number): number {
  if (chapters.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= time) idx = i;
    else break;
  }
  return idx;
}
