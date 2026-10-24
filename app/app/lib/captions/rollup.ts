import type { CaptionCue } from "./vtt"

/**
 * Roll-up captions, the way YouTube shows auto generated ones: each cue's
 * words come in one at a time across the cue, and the cues of one stretch of
 * talking stack up so the newest line pushes the older ones up. Auto tracks
 * have no per word timing, so words are spread over the cue by length.
 */

export interface RollWord {
  text: string
  /** Written straight after the word before it, with no space (CJK runs). */
  glued: boolean
}

export interface RollCue {
  key: number
  words: RollWord[]
  shown: number
}

/** Silence after a cue ends before the captions clear. */
export const ROLL_CLEAR_AFTER = 3
/** Cues kept on screen at most: two visible lines plus the one sliding out. */
const ROLL_MAX_CUES = 3
/** The last word lands a little before the cue ends, so the line rests whole. */
const REVEAL_SPAN = 0.85
/** Text without spaces is cut into pieces this long so it can wrap. */
const MAX_PIECE = 12

export interface RollTimeline {
  cues: CaptionCue[]
  words: RollWord[][]
  times: number[][]
}

function splitWords(text: string): RollWord[] {
  const out: RollWord[] = []
  for (const word of text.split(/\s+/)) {
    const chars = Array.from(word)
    for (let i = 0; i < chars.length; i += MAX_PIECE) {
      out.push({ text: chars.slice(i, i + MAX_PIECE).join(""), glued: i > 0 })
    }
  }
  return out
}

export function buildRollTimeline(cues: CaptionCue[]): RollTimeline {
  const words: RollWord[][] = []
  const times: number[][] = []
  for (const cue of cues) {
    const w = splitWords(cue.text)
    const total = w.reduce((n, word) => n + word.text.length + 1, 0)
    const span = Math.max(0, cue.end - cue.start) * REVEAL_SPAN
    let before = 0
    const t: number[] = []
    for (const word of w) {
      t.push(cue.start + (total > 0 ? (span * before) / total : 0))
      before += word.text.length + 1
    }
    words.push(w)
    times.push(t)
  }
  return { cues, words, times }
}

/** Index of the last cue that has started by time t, or -1. */
function lastStarted(cues: CaptionCue[], t: number): number {
  let lo = 0
  let hi = cues.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export function rollAt(timeline: RollTimeline, t: number): RollCue[] {
  const { cues, words, times } = timeline
  const last = lastStarted(cues, t)
  if (last < 0 || t > cues[last].end + ROLL_CLEAR_AFTER) return []
  let first = last
  while (
    first > 0 &&
    last - first + 1 < ROLL_MAX_CUES &&
    cues[first].start - cues[first - 1].end <= ROLL_CLEAR_AFTER
  ) {
    first--
  }
  const out: RollCue[] = []
  for (let i = first; i <= last; i++) {
    let shown = words[i].length
    if (i === last) {
      shown = 0
      while (shown < times[i].length && times[i][shown] <= t) shown++
    }
    if (shown > 0) out.push({ key: i, words: words[i], shown })
  }
  return out
}

/** Cheap identity for a roll state, so a render only happens when it changes. */
export function rollKey(roll: RollCue[]): string {
  return roll.map((c) => `${c.key}:${c.shown}`).join(",")
}

export interface RollLine {
  id: string
  words: RollWord[]
  /** How many of this line's words are on screen. */
  shown: number
  /** Width of the shown words, in px. */
  width: number
}

export type RollAlign = "left" | "center" | "right"

/** An inverted corner sitting just outside a line, where a wider line meets it. */
export interface RollFillet {
  corner: "tl" | "tr" | "bl" | "br"
  r: number
}

export interface RollShape {
  /** Corner radii in px: top left, top right, bottom right, bottom left. */
  radii: [number, number, number, number]
  fillets: RollFillet[]
}

/**
 * Shapes stacked line boxes into one block: outer corners round, a step where
 * one line is wider than its neighbour curves out and back in with the same
 * radius, and edges that line up stay square.
 */
export function joinLines(widths: number[], align: RollAlign, radius: number): RollShape[] {
  const edges = widths.map((w) =>
    align === "left" ? [0, w] : align === "right" ? [-w, 0] : [-w / 2, w / 2],
  )
  const shapes: RollShape[] = widths.map(() => ({ radii: [radius, radius, radius, radius], fillets: [] }))
  for (let i = 0; i + 1 < widths.length; i++) {
    const upper = shapes[i]
    const lower = shapes[i + 1]
    // Left side: positive when the upper line sticks out further.
    const left = edges[i + 1][0] - edges[i][0]
    if (Math.abs(left) < 1) {
      upper.radii[3] = 0
      lower.radii[0] = 0
    } else if (left > 0) {
      const r = Math.min(radius, left / 2)
      upper.radii[3] = r
      lower.radii[0] = 0
      lower.fillets.push({ corner: "tl", r })
    } else {
      const r = Math.min(radius, -left / 2)
      lower.radii[0] = r
      upper.radii[3] = 0
      upper.fillets.push({ corner: "bl", r })
    }
    const right = edges[i][1] - edges[i + 1][1]
    if (Math.abs(right) < 1) {
      upper.radii[2] = 0
      lower.radii[1] = 0
    } else if (right > 0) {
      const r = Math.min(radius, right / 2)
      upper.radii[2] = r
      lower.radii[1] = 0
      lower.fillets.push({ corner: "tr", r })
    } else {
      const r = Math.min(radius, -right / 2)
      lower.radii[1] = r
      upper.radii[2] = 0
      upper.fillets.push({ corner: "br", r })
    }
  }
  return shapes
}

/**
 * Wraps each cue's words into lines no wider than maxWidth, always starting a
 * cue on a new line. The whole cue is wrapped up front, so a line's words stay
 * where they are while the rest of it is still coming in.
 */
export function layoutRoll(
  roll: RollCue[],
  maxWidth: number,
  measure: (text: string) => number,
): RollLine[] {
  const space = measure(" ")
  const lines: RollLine[] = []
  for (const cue of roll) {
    let start = 0
    let lineIndex = 0
    let words: RollWord[] = []
    let widths: number[] = []
    let lineWidth = 0
    const gap = (word: RollWord, i: number) => (i > 0 && !word.glued ? space : 0)
    const flush = () => {
      const shownHere = Math.max(0, Math.min(words.length, cue.shown - start))
      if (shownHere > 0) {
        let width = 0
        for (let i = 0; i < shownHere; i++) width += widths[i] + gap(words[i], i)
        lines.push({ id: `${cue.key}:${lineIndex}`, words, shown: shownHere, width })
      }
      start += words.length
      lineIndex++
      words = []
      widths = []
      lineWidth = 0
    }
    for (const word of cue.words) {
      const w = measure(word.text)
      const extra = words.length > 0 && !word.glued ? space : 0
      if (words.length > 0 && lineWidth + extra + w > maxWidth) flush()
      lineWidth += gap(word, words.length) + w
      words.push(word)
      widths.push(w)
    }
    if (words.length > 0) flush()
  }
  return lines
}
