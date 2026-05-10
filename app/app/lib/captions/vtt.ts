import { GenerateUniqueID } from "~/lib/GenerateUniqueID"

export interface CaptionCue {
  id: string
  start: number
  end: number
  text: string
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
  const s = Math.max(0, seconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const secs = Math.floor(s % 60)
  const ms = Math.floor((s - Math.floor(s)) * 1000)
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

    cues.push({ id: GenerateUniqueID(), start, end, text: cleaned })
  }

  cues.sort((a, b) => a.start - b.start)
  return { cues, errors, truncated }
}

export function serializeVTT(track: CaptionTrack): string {
  const header = "WEBVTT\n\n"
  const body = track.cues
    .map((cue, idx) => {
      const text = sanitizeCueText(cue.text) || ""
      return `${idx + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${text}`
    })
    .join("\n\n")
  return header + body + (body ? "\n" : "")
}

export interface CaptionEntry {
  language: string
  path: string
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
      if (langRaw) out.push({ language: langRaw, path: pathRaw })
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
