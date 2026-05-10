import { randomBytes } from "node:crypto"

const BCP47_RE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/

export const MAX_LANGUAGES_PER_FILE = 30
export const MAX_VTT_BYTES = 1 * 1024 * 1024
export const TOKEN_TTL_SECONDS = 5 * 60

export function isValidLanguageCode(code: string): boolean {
  return BCP47_RE.test(code.trim())
}

export function normalizeLanguageCode(code: string): string {
  return code.trim()
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

export function arrangeDateFolder(createdAt: string): string {
  const date = new Date(createdAt)
  const day = date.getUTCDate().toString().padStart(2, "0")
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0")
  const year = date.getUTCFullYear()
  return `${day}_${month}_${year}`
}

const SAFE_UNIQUE_ID = /^[A-Za-z0-9_-]{1,128}$/

export function isSafeUniqueId(s: string): boolean {
  return typeof s === "string" && SAFE_UNIQUE_ID.test(s)
}

const SAFE_GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/

export function isSafeGithubRepo(s: string): boolean {
  return typeof s === "string" && SAFE_GITHUB_REPO.test(s)
}
