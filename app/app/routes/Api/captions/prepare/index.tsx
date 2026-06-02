import { data } from "react-router"
import { isAuthenticated } from "~/lib/Security/Password"
import db from "~/lib/Database/supabase"
import { isValidUUID } from "~/lib/Security/inputValidation"
import { resolveGithubRepoForFile } from "~/lib/githubStorage"
import {
  MAX_LANGUAGES_PER_FILE,
  TOKEN_TTL_SECONDS,
  arrangeDateFolder,
  generateToken,
  isSafeGithubRepo,
  isSafeUniqueId,
  isValidLanguageCode,
  normalizeLanguageCode,
} from "~/lib/captions/server"

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 })
  }

  const user = await isAuthenticated(request, ["id"])
  if (!user || !user.id) {
    return data({ error: "Unauthorized" }, { status: 401 })
  }

  const expectedOrigin = (process.env.APP_BASE_URL || "").replace(/\/$/, "")
  if (expectedOrigin) {
    const origin = request.headers.get("Origin") ?? ""
    const refOrigin = (() => {
      const ref = request.headers.get("Referer") ?? ""
      try {
        return ref ? new URL(ref).origin : ""
      } catch {
        return ""
      }
    })()
    const ok = origin === expectedOrigin || refOrigin === expectedOrigin
    if (!ok) return data({ error: "Forbidden" }, { status: 403 })
  }

  if (!db) return data({ error: "Database not available" }, { status: 503 })

  let body: { file_id?: string; language?: string; action?: string }
  try {
    body = await request.json()
  } catch {
    return data({ error: "Invalid JSON" }, { status: 400 })
  }

  const fileId = typeof body.file_id === "string" ? body.file_id.trim() : ""
  const language = typeof body.language === "string" ? normalizeLanguageCode(body.language) : ""
  const actionType = body.action === "delete" ? "delete" : body.action === "upload" ? "upload" : ""

  if (!isValidUUID(fileId)) return data({ error: "Invalid file_id" }, { status: 400 })
  if (!isValidLanguageCode(language)) return data({ error: "Invalid language" }, { status: 400 })
  if (!actionType) return data({ error: "Invalid action" }, { status: 400 })

  const { data: fileRow, error: fileErr } = await db
    .from("files")
    .select("id, unique_id, created_at, owner_id, file_type, captions, github_repo, storage_backend")
    .eq("id", fileId)
    .maybeSingle()
  if (fileErr) {
    console.error("[api/captions/prepare] file lookup:", fileErr)
    return data({ error: "Failed to verify file" }, { status: 500 })
  }
  if (!fileRow) return data({ error: "File not found" }, { status: 404 })
  if (String(fileRow.owner_id) !== String(user.id)) {
    return data({ error: "Forbidden" }, { status: 403 })
  }

  const fileType = fileRow.file_type ? String(fileRow.file_type).toLowerCase() : ""
  if (fileType.startsWith("image/")) {
    return data({ error: "Captions are not allowed on images" }, { status: 400 })
  }

  const existingLanguages = extractCaptionLanguages(fileRow.captions)
  if (actionType === "upload" && !existingLanguages.includes(language) && existingLanguages.length >= MAX_LANGUAGES_PER_FILE) {
    return data({ error: "Language limit reached" }, { status: 409 })
  }
  if (actionType === "delete" && !existingLanguages.includes(language)) {
    return data({ error: "Language not present on this file" }, { status: 404 })
  }

  const uniqueId = fileRow.unique_id != null ? String(fileRow.unique_id).trim() : ""
  if (!isSafeUniqueId(uniqueId)) return data({ error: "File metadata invalid" }, { status: 500 })

  const createdAt = fileRow.created_at != null ? String(fileRow.created_at) : ""
  if (!createdAt) return data({ error: "File metadata invalid" }, { status: 500 })
  const dateFolder = arrangeDateFolder(createdAt)

  const backend = (fileRow as { storage_backend?: string | null }).storage_backend === "r2" ? "r2" : "github"
  // GitHub-backed captions need a valid repo; R2 captions follow the file's bucket.
  let githubRepo = ""
  if (backend === "github") {
    try {
      githubRepo = resolveGithubRepoForFile({ github_repo: fileRow.github_repo as string | null })
    } catch {
      return data({ error: "Storage not configured" }, { status: 503 })
    }
    if (!isSafeGithubRepo(githubRepo)) {
      return data({ error: "File metadata invalid" }, { status: 500 })
    }
  }

  const token = generateToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString()

  const { error: tokenErr } = await db.from("caption_tokens").insert({
    token,
    user_id: user.id,
    file_id: fileRow.id,
    unique_id: uniqueId,
    date_folder: dateFolder,
    github_repo: githubRepo,
    storage_backend: backend,
    language,
    action: actionType,
    expires_at: expiresAt,
  })
  if (tokenErr) {
    console.error("[api/captions/prepare] token mint:", tokenErr)
    return data({ error: "Token mint failed" }, { status: 500 })
  }

  return data(
    {
      token,
      expires_at: expiresAt,
      upload_server_url: (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || "").replace(/\/$/, ""),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  )
}

function extractCaptionLanguages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const lang = (entry as Record<string, unknown>).language
    if (typeof lang === "string" && lang.trim()) out.push(lang.trim())
  }
  return out
}
