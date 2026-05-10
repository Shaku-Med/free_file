import { data } from "react-router"
import db from "~/lib/Database/supabase"
import { isValidFileId, isValidUUID } from "~/lib/Security/inputValidation"
import { isAuthenticated } from "~/lib/Security/Password"
import { canAccessFile, type FileData } from "~/routes/Api/fun/accessControl"
import { resolveGithubRepoForFile } from "~/lib/githubStorage"
import {
  generateToken,
  isSafeGithubRepo,
  isValidLanguageCode,
  normalizeLanguageCode,
} from "~/lib/captions/server"
import { normalizeCaptionEntries } from "~/lib/captions/vtt"

const LOAD_TOKEN_TTL_SECONDS = 30
const SAFE_PATH_RE = /^[A-Za-z0-9._\-/]{1,256}$/

const ok = (body: unknown, status = 200) =>
  data(body, { status, headers: { "Cache-Control": "no-store" } })

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return ok({ error: "Method not allowed" }, 405)
  if (!db) return ok({ error: "unavailable" }, 503)

  const user = await isAuthenticated(request, ["id"])
  if (!user || !user.id) return ok({ error: "auth required" }, 401)

  let body: { unique_id?: string; file_id?: string; language?: string }
  try {
    body = await request.json()
  } catch {
    return ok({ error: "invalid json" }, 400)
  }

  const lookup =
    typeof body.unique_id === "string" && body.unique_id.trim()
      ? body.unique_id.trim()
      : typeof body.file_id === "string"
      ? body.file_id.trim()
      : ""
  const language =
    typeof body.language === "string" ? normalizeLanguageCode(body.language) : ""

  if (!lookup || !isValidFileId(lookup)) return ok({ error: "invalid lookup" }, 400)
  if (!isValidLanguageCode(language)) return ok({ error: "invalid language" }, 400)

  const lookupColumn = isValidUUID(lookup) ? "id" : "unique_id"

  const { data: row, error: fetchErr } = await db
    .from("files")
    .select(
      "id, unique_id, owner_id, is_public, is_adult, upload_status, github_repo, captions",
    )
    .eq(lookupColumn, lookup)
    .maybeSingle()
  if (fetchErr) {
    console.error("[captions/load-prepare] fetch:", fetchErr)
    return ok({ error: "fetch failed" }, 500)
  }
  if (!row) return ok({ error: "not found" }, 404)

  const allowed = await canAccessFile(request, row as FileData)
  if (!allowed) return ok({ error: "forbidden" }, 403)

  const entries = normalizeCaptionEntries(row.captions)
  const matched = entries.find((e) => e.language === language && e.path)
  if (!matched) return ok({ error: "caption not found" }, 404)

  const path = matched.path
  if (!SAFE_PATH_RE.test(path) || path.includes("..") || !path.endsWith(".vtt")) {
    return ok({ error: "invalid stored path" }, 500)
  }

  let githubRepo: string
  try {
    githubRepo = resolveGithubRepoForFile({
      github_repo: row.github_repo as string | null,
    })
  } catch {
    return ok({ error: "storage not configured" }, 503)
  }
  if (!isSafeGithubRepo(githubRepo)) return ok({ error: "metadata invalid" }, 500)

  const token = generateToken()
  const expiresAt = new Date(Date.now() + LOAD_TOKEN_TTL_SECONDS * 1000).toISOString()

  const { error: mintErr } = await db.from("caption_load_tokens").insert({
    token,
    file_id: row.id,
    language,
    path,
    github_repo: githubRepo,
    expires_at: expiresAt,
  })
  if (mintErr) {
    console.error("[captions/load-prepare] mint:", mintErr)
    return ok({ error: "mint failed" }, 500)
  }

  return ok({ token, path, expires_at: expiresAt })
}
