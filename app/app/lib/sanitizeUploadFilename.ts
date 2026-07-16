/**
 * Client-side filename cleanup before upload so GoUpload SafeUploadFilename
 * does not reject names for shell/SQL-sensitive characters.
 */

const FILENAME_SYMBOL_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["&", "and"],
  ["|", "or"],
  [";", ""],
  ["$", "dollar"],
  ["`", ""],
  ["<", ""],
  [">", ""],
  ["'", ""],
  ['"', ""],
  ["\\", ""],
  ["/", "-"],
  ["\n", " "],
  ["\r", " "],
  ["\t", " "],
  ["*", ""],
  ["?", ""],
  [":", "-"],
  ["!", ""],
  ["#", ""],
  ["%", "percent"],
  ["@", "at"],
  ["{", ""],
  ["}", ""],
  ["[", ""],
  ["]", ""],
  ["^", ""],
  ["~", ""],
  ["=", "equals"],
  ["+", "plus"],
]

const MAX_UPLOAD_FILENAME_LEN = 220

export function sanitizeUploadFilename(raw: string): string {
  let name = String(raw ?? "")
    .normalize("NFKC")
    .replace(/\0/g, "")
    .trim()

  name = name.replace(/^.*[/\\]/, "")
  if (!name || name === "." || name === "..") return "file.bin"

  for (const [symbol, word] of FILENAME_SYMBOL_WORDS) {
    if (!name.includes(symbol)) continue
    name = name.split(symbol).join(word ? ` ${word} ` : " ")
  }

  name = name.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim()
  while (name.startsWith("-")) name = name.slice(1).trim()
  if (!name) name = "file"

  const lastDot = name.lastIndexOf(".")
  let base = lastDot > 0 ? name.slice(0, lastDot).trim() : name
  let ext = lastDot > 0 ? name.slice(lastDot) : ""
  base = base.replace(/\s+/g, " ").trim() || "file"
  ext = ext.replace(/[^a-zA-Z0-9.]/g, "")
  if (ext === "." || ext.length < 2) ext = ""

  let out = ext ? `${base}${ext}` : base
  if (out.length > MAX_UPLOAD_FILENAME_LEN) {
    const room = Math.max(1, MAX_UPLOAD_FILENAME_LEN - ext.length)
    base = base.slice(0, room).trim() || "file"
    out = ext ? `${base}${ext}` : base
  }

  if (!ext) {
    const fallbackExt = guessSafeExt(raw)
    out = `${base}${fallbackExt}`
  }

  if (out.startsWith("-")) out = `file${out}`
  return out
}

function guessSafeExt(raw: string): string {
  const m = String(raw).match(/(\.[a-zA-Z0-9]{1,12})$/)
  if (m) return m[1].replace(/[^a-zA-Z0-9.]/g, "") || ".bin"
  return ".bin"
}

export function fileWithSanitizedUploadName(file: File): File {
  const nextName = sanitizeUploadFilename(file.name)
  if (nextName === file.name) return file
  return new File([file], nextName, {
    type: file.type,
    lastModified: file.lastModified,
  })
}
