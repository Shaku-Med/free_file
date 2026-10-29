import { GenerateUniqueID } from "~/lib/GenerateUniqueID"

export interface CaptionWord {
  text: string
  /** Seconds. When this word is said, from the cue's in-text timestamp tags. */
  start: number
  /** Written straight after the word before it, with no space (CJK). */
  glued?: boolean
}

export interface CaptionCue {
  id: string
  start: number
  end: number
  text: string
  /** Per word timing, when the file has it (auto generated captions do). */
  words?: CaptionWord[]
}

export interface CaptionTrack {
  language: string
  label: string
  cues: CaptionCue[]
}

export const MAX_CUES = 5000
export const MAX_CUE_TEXT_LENGTH = 1000
export const MAX_VTT_BYTES = 2 * 1024 * 1024

export const SUPPORTED_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "ru", label: "Russian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "zh-Hant", label: "Chinese (Traditional)" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
  { code: "th", label: "Thai" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "tl", label: "Filipino" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "cs", label: "Czech" },
  { code: "el", label: "Greek" },
  { code: "he", label: "Hebrew" },
  { code: "uk", label: "Ukrainian" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
  { code: "fa", label: "Persian" },
  { code: "sw", label: "Swahili" },
  { code: "yo", label: "Yoruba" },
  { code: "ig", label: "Igbo" },
  { code: "ha", label: "Hausa" },
  { code: "am", label: "Amharic" },
  { code: "ur", label: "Urdu" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "ml", label: "Malayalam" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "pa", label: "Punjabi" },
]

const BCP47_RE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/

export function isValidLanguageCode(code: string): boolean {
  return BCP47_RE.test(code.trim())
}

export function findLanguageLabel(code: string): string {
  const found = SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === code.toLowerCase())
  return found?.label || code
}

export function clampNumber(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

export function formatTimestamp(seconds: number): string {
  // Whole milliseconds first: 39.11 is 39.10999... as a float, and taking the
  // fraction straight wrote 39.109, a millisecond lost on every save.
  const total = Math.round(Math.max(0, seconds) * 1000)
  const hours = Math.floor(total / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const secs = Math.floor((total % 60000) / 1000)
  const ms = total % 1000
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(secs).padStart(2, "0") +
    "." +
    String(ms).padStart(3, "0")
  )
}

export function parseTimestamp(value: string): number | null {
  const trimmed = value.trim()
  const m = trimmed.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/)
  if (!m) return null
  const [, hh, mm, ss, msRaw] = m
  const hours = hh ? Number(hh) : 0
  const minutes = Number(mm)
  const seconds = Number(ss)
  if (minutes >= 60 || seconds >= 60) return null
  const ms = msRaw ? Number(msRaw.padEnd(3, "0").slice(0, 3)) : 0
  return hours * 3600 + minutes * 60 + seconds + ms / 1000
}

const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
}

function stripControlChars(input: string): string {
  let out = ""
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const code = input.charCodeAt(i)
    if (ch === "\n" || ch === "\t") {
      out += ch
      continue
    }
    if (code < 0x20 || code === 0x7f) continue
    out += ch
  }
  return out
}

export function sanitizeCueText(input: string): string {
  let out = String(input ?? "")
  out = out.replace(/<[^>]*>/g, "")
  out = out.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITY_MAP[m] ?? "")
  out = out.replace(/&#x?[0-9a-f]+;/gi, "")
  out = out.replace(/\r\n?/g, "\n")
  out = stripControlChars(out)
  out = out.replace(/[ \t]+/g, " ")
  out = out
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (out.length > MAX_CUE_TEXT_LENGTH) out = out.slice(0, MAX_CUE_TEXT_LENGTH)
  return out
}

const CUE_TIMESTAMP_TAG = /<((?:\d{1,3}:)?\d{1,2}:\d{1,2}[.,]\d{1,3})>/g

/**
 * Reads WebVTT's in-cue timestamp tags ("Good <00:00:02.390>morning") into
 * words with the time each is said. Text before the first tag starts with the
 * cue. Returns undefined when the cue has no timing tags.
 */
function parseTimedWords(raw: string, cueStart: number, cueEnd: number): CaptionWord[] | undefined {
  if (!CUE_TIMESTAMP_TAG.test(raw)) return undefined
  CUE_TIMESTAMP_TAG.lastIndex = 0
  const words: CaptionWord[] = []
  let at = cueStart
  let last = 0
  // A tag with no space before it continues the word before (CJK text).
  let glueNext = false
  const take = (chunk: string) => {
    const parts = sanitizeCueText(chunk).split(/\s+/).filter(Boolean)
    parts.forEach((text, i) => {
      const glued = i === 0 && glueNext && words.length > 0 && !/^\s/.test(chunk)
      words.push(glued ? { text, start: at, glued } : { text, start: at })
    })
  }
  for (const m of raw.matchAll(CUE_TIMESTAMP_TAG)) {
    const chunk = raw.slice(last, m.index)
    take(chunk)
    glueNext = chunk.length > 0 && !/\s$/.test(chunk)
    const t = parseTimestamp(m[1])
    if (t !== null) at = Math.min(cueEnd, Math.max(at, t))
    last = (m.index ?? 0) + m[0].length
  }
  take(raw.slice(last))
  return words.length > 0 ? words : undefined
}

export function makeEmptyCue(start = 0, end = 2): CaptionCue {
  return { id: GenerateUniqueID(), start, end, text: "" }
}

export interface ParseResult {
  cues: CaptionCue[]
  errors: string[]
  truncated: boolean
}

export function parseVTT(source: string): ParseResult {
  const errors: string[] = []
  const cues: CaptionCue[] = []
  let truncated = false

  if (!source || typeof source !== "string") {
    return { cues, errors: ["Empty file"], truncated: false }
  }
  if (source.length > MAX_VTT_BYTES) {
    errors.push("File exceeds size limit and was truncated")
    source = source.slice(0, MAX_VTT_BYTES)
    truncated = true
  }

  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean)

  for (const block of blocks) {
    if (cues.length >= MAX_CUES) {
      truncated = true
      errors.push(`Stopped at ${MAX_CUES} cues`)
      break
    }
    const lines = block.split("\n")
    if (lines.length === 0) continue

    const first = lines[0].trim()
    if (/^WEBVTT/i.test(first)) continue
    if (/^NOTE\b/i.test(first)) continue
    if (/^STYLE\b/i.test(first)) continue
    if (/^REGION\b/i.test(first)) continue

    let timingLineIdx = -1
    for (let i = 0; i < Math.min(lines.length, 2); i++) {
      if (lines[i].includes("-->")) {
        timingLineIdx = i
        break
      }
    }
    if (timingLineIdx === -1) continue

    const timing = lines[timingLineIdx]
    const arrowIdx = timing.indexOf("-->")
    const startStr = timing.slice(0, arrowIdx).trim()
    const endPart = timing.slice(arrowIdx + 3).trim().split(/\s+/)[0]
    const start = parseTimestamp(startStr)
    const end = parseTimestamp(endPart)
    if (start === null || end === null || end <= start) {
      errors.push(`Invalid timestamp: "${timing}"`)
      continue
    }

    const textLines = lines.slice(timingLineIdx + 1).join("\n")
    const cleaned = sanitizeCueText(textLines)
    if (!cleaned) continue

    const words = parseTimedWords(textLines, start, end)
    cues.push(words ? { id: GenerateUniqueID(), start, end, text: cleaned, words } : { id: GenerateUniqueID(), start, end, text: cleaned })
  }

  cues.sort((a, b) => a.start - b.start)
  return { cues, errors, truncated }
}

/**
 * A cue's text with its word times written back in as timestamp tags, so a
 * track that had them keeps them when it's saved. Plain text when the words
 * don't spell the text any more.
 */
function cueBody(cue: CaptionCue): string {
  const text = sanitizeCueText(cue.text) || ""
  const words = cue.words
  if (!words?.length) return text
  const spelled = words.map((w, i) => (i > 0 && !w.glued ? " " : "") + w.text).join("")
  if (spelled !== text.replace(/\s+/g, " ")) return text
  return words
    .map((w, i) => {
      if (i === 0) return w.text
      const at = Math.min(cue.end, Math.max(cue.start, w.start))
      return `${w.glued ? "" : " "}<${formatTimestamp(at)}>${w.text}`
    })
    .join("")
}

export function serializeVTT(track: CaptionTrack): string {
  const header = "WEBVTT\n\n"
  const body = track.cues
    .map((cue, idx) => `${idx + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cueBody(cue)}`)
    .join("\n\n")
  return header + body + (body ? "\n" : "")
}

const comparable = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

/**
 * Word times for an edited line. Words still there keep the time they had;
 * new ones are spread between the kept words around them, so fixing a typo
 * or a misheard word doesn't cost the line its sync.
 */
export function retimeWords(old: CaptionWord[], text: string, start: number, end: number): CaptionWord[] | undefined {
  // Glued pieces (CJK) belong to the space separated word before them.
  const before: { text: string; start: number }[] = []
  for (const w of old) {
    if (w.glued && before.length > 0) before[before.length - 1].text += w.text
    else before.push({ text: w.text, start: w.start })
  }
  const after = sanitizeCueText(text).split(/\s+/).filter(Boolean)
  if (after.length === 0 || before.length === 0) return undefined

  // Longest common run of words, to tell kept words from changed ones.
  const a = before.map((w) => comparable(w.text))
  const b = after.map(comparable)
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const times: (number | undefined)[] = new Array(after.length)
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) times[j++] = before[i++].start
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++
    else j++
  }

  const last = Math.max(start, end - 0.05)
  for (let j = 0; j < after.length; ) {
    if (times[j] !== undefined) {
      j++
      continue
    }
    let k = j
    while (k < after.length && times[k] === undefined) k++
    const from = j > 0 ? (times[j - 1] as number) : start
    const to = k < after.length ? (times[k] as number) : Math.min(last, from + (k - j + 1) * 0.3)
    for (let m = j; m < k; m++) times[m] = from + ((to - from) * (m - j + 1)) / (k - j + 1)
    j = k
  }
  let prev = start
  return after.map((word, j) => {
    prev = Math.min(last, Math.max(prev, times[j] as number))
    return { text: word, start: j === 0 ? start : prev }
  })
}

type GridRun = { start: number; end: number; text: string; from: CaptionCue[] }

/**
 * The editor works on a grid of whole seconds, which can't hold a cue's exact
 * times or its word timing, and a cue shorter than a second can lose its only
 * row to the next one. This remembers the cues the editor was opened with and,
 * every time the grid turns back into cues, restores all of that on each line
 * that wasn't touched. An edited line keeps its exact start and end where those
 * didn't move, and its words are retimed rather than dropped.
 */
export function createTimingKeeper(originals: CaptionCue[], totalSeconds: number) {
  const sorted = [...originals].sort((x, y) => x.start - y.start)
  const runs: GridRun[] = secondsMapToCues(cuesToSecondsMap(sorted, totalSeconds)).map((run) => ({
    start: run.start,
    end: run.end,
    text: run.text,
    from: [],
  }))
  for (const cue of sorted) {
    const text = sanitizeCueText(cue.text)
    // Its own run if it has rows left, otherwise the run that covered it.
    const run =
      runs.find((r) => r.text === text && cue.start < r.end && cue.end > r.start) ??
      runs.find((r) => cue.start < r.end && cue.end > r.start)
    run?.from.push(cue)
  }

  return (rebuilt: CaptionCue[]): CaptionCue[] =>
    rebuilt.flatMap((cue) => {
      const same = runs.find((r) => r.start === cue.start && r.end === cue.end && r.text === cue.text)
      if (same && same.from.length > 0) return same.from
      const overlap = (r: GridRun) => Math.min(cue.end, r.end) - Math.max(cue.start, r.start)
      const near = runs
        .filter((r) => r.from.length > 0 && overlap(r) > 0)
        .sort((x, y) => overlap(y) - overlap(x))[0]
      // The row's own line, not a shorter one it covered.
      const source = near && (near.from.find((c) => sanitizeCueText(c.text) === near.text) ?? near.from[0])
      if (!near || !source) return [cue]
      const start = cue.start === near.start ? source.start : cue.start
      const end = cue.end === near.end ? source.end : cue.end
      if (end <= start) return [cue]
      const words = source.words ? retimeWords(source.words, cue.text, start, end) : undefined
      return [words ? { ...cue, start, end, words } : { ...cue, start, end }]
    })
}

export interface CaptionEntry {
  language: string
  path: string
  /** Made from the video's speech, not uploaded by the owner. */
  auto?: boolean
}

export function captionLabel(entry: { language: string; auto?: boolean }): string {
  const label = findLanguageLabel(entry.language)
  return entry.auto ? `${label} (auto generated)` : label
}

function tryUnwrapJsonEntry(val: string): CaptionEntry | null {
  const s = val.trim()
  if (!s.startsWith("{")) return null
  try {
    const parsed = JSON.parse(s) as Record<string, unknown>
    if (parsed && typeof parsed === "object") {
      const lang = typeof parsed.language === "string" ? parsed.language.trim() : ""
      const path = typeof parsed.path === "string" ? parsed.path.trim() : ""
      if (lang) return { language: lang, path }
    }
  } catch {
    /* not JSON */
  }
  return null
}

export function normalizeCaptionEntries(raw: unknown): CaptionEntry[] {
  let arr: unknown = raw
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr)
    } catch {
      return []
    }
  }
  if (!Array.isArray(arr)) return []

  const out: CaptionEntry[] = []
  for (const entry of arr) {
    if (typeof entry === "string") {
      const unwrapped = tryUnwrapJsonEntry(entry)
      if (unwrapped) {
        out.push(unwrapped)
        continue
      }
      const code = entry.trim()
      if (code) out.push({ language: code, path: "" })
      continue
    }
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>
      const langRaw = typeof e.language === "string" ? e.language.trim() : ""
      const pathRaw = typeof e.path === "string" ? e.path.trim() : ""
      if (langRaw.startsWith("{")) {
        const unwrapped = tryUnwrapJsonEntry(langRaw)
        if (unwrapped) {
          out.push({
            language: unwrapped.language,
            path: unwrapped.path || pathRaw,
          })
          continue
        }
      }
      if (langRaw) out.push(e.auto === true ? { language: langRaw, path: pathRaw, auto: true } : { language: langRaw, path: pathRaw })
    }
  }
  return out
}

export function cuesToSecondsMap(
  cues: CaptionCue[],
  totalSeconds: number,
): Map<number, string> {
  const map = new Map<number, string>()
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return map
  const cap = Math.floor(totalSeconds)
  for (const cue of cues) {
    const cleaned = sanitizeCueText(cue.text)
    if (!cleaned) continue
    const start = Math.max(0, Math.floor(cue.start))
    const end = Math.min(cap, Math.ceil(cue.end))
    for (let s = start; s < end; s++) map.set(s, cleaned)
  }
  return map
}

export function secondsMapToCues(map: Map<number, string>): CaptionCue[] {
  const entries = Array.from(map.entries())
    .filter(([, text]) => sanitizeCueText(text).length > 0)
    .sort((a, b) => a[0] - b[0])

  const cues: CaptionCue[] = []
  let runStart: number | null = null
  let runText = ""
  let prevSecond = -2

  const flush = (endSecond: number) => {
    if (runStart === null) return
    cues.push({
      id: GenerateUniqueID(),
      start: runStart,
      end: endSecond + 1,
      text: sanitizeCueText(runText),
    })
    runStart = null
    runText = ""
  }

  for (const [second, text] of entries) {
    const cleaned = sanitizeCueText(text)
    if (runStart === null) {
      runStart = second
      runText = cleaned
      prevSecond = second
      continue
    }
    if (second === prevSecond + 1 && cleaned === runText) {
      prevSecond = second
      continue
    }
    flush(prevSecond)
    runStart = second
    runText = cleaned
    prevSecond = second
  }
  flush(prevSecond)
  return cues
}

export function validateTrack(track: CaptionTrack): string | null {
  if (!isValidLanguageCode(track.language)) return "Invalid language code"
  if (track.cues.length === 0) return "Add at least one cue"
  for (const cue of track.cues) {
    if (cue.end <= cue.start) return "A cue ends before it starts"
    if (!sanitizeCueText(cue.text)) return "A cue has empty text"
  }
  return null
}
