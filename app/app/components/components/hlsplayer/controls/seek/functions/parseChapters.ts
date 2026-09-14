import { createTimestampRegex, timestampMatchToSeconds } from '~/lib/timestamps';

// Chapters from a description, following YouTube's rules so a stray time in a
// sentence never splits the bar:
//   - a line's timestamp must lead it ("0:00 Intro") or end it ("Intro - 0:00")
//   - the list starts at 0:00 and ends at the first time that doesn't move forward
//   - at least 3 chapters, each at least 10 seconds long
//
// This also runs while the watch page renders on the server, and the description
// is uploader controlled, so every step is linear and the input is bounded.

export interface Chapter {
  start: number;
  title: string;
}

const MIN_CHAPTERS = 3;
const MAX_CHAPTERS = 100;
const MIN_CHAPTER_SECONDS = 10;
const MAX_TITLE = 120;
const MAX_LINE = 200;
const MAX_SCAN = 10_000;

// What may sit before a leading time or after a trailing one.
const LEAD_ONLY = /^[\s[(\u2022\u00b7*\-\u2013\u2014]*$/;
const TRAIL_ONLY = /^[\s)\]]*$/;
const TITLE_START = new Set(['-', '\u2013', '\u2014', ':', '|', '\u2022', '\u00b7', '.', ')', ']']);
const TITLE_END = new Set(['-', '\u2013', '\u2014', ':', '|', '\u2022', '\u00b7', '(', '[']);
const SPACE = /\s/;

// A loop, not an end-anchored regex: `[...]+$` rescans the rest of the string
// from every position and goes quadratic on long runs of separators.
function trimTitle(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && (SPACE.test(raw[start]) || TITLE_START.has(raw[start]))) start++;
  while (end > start && (SPACE.test(raw[end - 1]) || TITLE_END.has(raw[end - 1]))) end--;
  return raw.slice(start, end);
}

function parseLine(line: string): Chapter | null {
  const text = line.trim();
  if (!text || text.length > MAX_LINE) return null;

  const matches = [...text.matchAll(createTimestampRegex())];
  if (matches.length === 0) return null;

  const first = matches[0];
  const last = matches[matches.length - 1];
  let match: RegExpMatchArray;
  let title: string;

  if (LEAD_ONLY.test(text.slice(0, first.index))) {
    match = first;
    title = text.slice(first.index! + first[0].length);
  } else if (TRAIL_ONLY.test(text.slice(last.index! + last[0].length))) {
    match = last;
    title = text.slice(0, last.index);
  } else {
    return null;
  }

  title = trimTitle(title).slice(0, MAX_TITLE);
  if (!title) return null;
  return { start: timestampMatchToSeconds(match), title };
}

export function parseChapters(
  description: string | null | undefined,
  duration: number,
): Chapter[] {
  if (!description || !Number.isFinite(duration) || duration <= 0) return [];

  const chapters: Chapter[] = [];
  for (const line of description.slice(0, MAX_SCAN).split(/\r?\n/)) {
    const chapter = parseLine(line);
    if (!chapter) continue;
    if (chapters.length === 0) {
      if (chapter.start === 0) chapters.push(chapter);
      continue;
    }
    const prev = chapters[chapters.length - 1];
    if (chapter.start <= prev.start || chapter.start >= duration) break;
    // Past this the bar is slivers too thin to hit, so no sections at all
    // rather than a truncated list with the last one mislabelled.
    if (chapters.length === MAX_CHAPTERS) return [];
    chapters.push(chapter);
  }

  if (chapters.length < MIN_CHAPTERS) return [];
  for (let i = 0; i < chapters.length; i++) {
    const end = i + 1 < chapters.length ? chapters[i + 1].start : duration;
    if (end - chapters[i].start < MIN_CHAPTER_SECONDS) return [];
  }
  return chapters;
}

/** Index of the chapter covering `time`, or -1. Chapters must be sorted. */
export function activeChapterIndex(chapters: Chapter[], time: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= time) idx = i;
    else break;
  }
  return idx;
}
