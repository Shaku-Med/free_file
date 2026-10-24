export interface StoredCaption {
  language: string
  path: string
  auto?: true
}

/** files.captions as stored, keeping only well formed entries. */
export function sanitizeStoredCaptions(raw: unknown): StoredCaption[] {
  if (!Array.isArray(raw)) return []
  const out: StoredCaption[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const language = typeof e.language === "string" ? e.language.trim() : ""
    const path = typeof e.path === "string" ? e.path.trim() : ""
    if (!language || !path) continue
    out.push(e.auto === true ? { language, path, auto: true } : { language, path })
  }
  return out
}
