import { data } from "react-router"
import db from "~/lib/Database/supabase"
import { isValidUUID } from "~/lib/Security/inputValidation"
import { isValidLanguageCode, normalizeLanguageCode } from "~/lib/captions/server"

const ok = (body: unknown, status = 200) =>
  data(body, { status, headers: { "Cache-Control": "no-store" } })

interface CaptionEntry {
  language: string
  path: string
}

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return ok({ error: "Method not allowed" }, 405)

  const secret =
    request.headers.get("X-Webhook-Secret") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim()
  const expected = process.env.UPLOAD_WEBHOOK_SECRET ?? ""
  if (!expected || secret !== expected) return ok({ error: "unauthorized" }, 401)

  if (!db) return ok({ error: "unavailable" }, 503)

  let body: { file_id?: string; user_id?: string; language?: string }
  try {
    body = await request.json()
  } catch {
    return ok({ error: "invalid json" }, 400)
  }

  const fileId = typeof body.file_id === "string" ? body.file_id.trim() : ""
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : ""
  const language = typeof body.language === "string" ? normalizeLanguageCode(body.language) : ""

  if (!isValidUUID(fileId)) return ok({ error: "invalid file_id" }, 400)
  if (!isValidUUID(userId)) return ok({ error: "invalid user_id" }, 400)
  if (!isValidLanguageCode(language)) return ok({ error: "invalid language" }, 400)

  const { data: row, error: fetchErr } = await db
    .from("files")
    .select("id, owner_id, captions")
    .eq("id", fileId)
    .maybeSingle()
  if (fetchErr) {
    console.error("[internal/captions/uncommit] fetch:", fetchErr)
    return ok({ error: "fetch failed" }, 500)
  }
  if (!row) return ok({ error: "file not found" }, 404)
  if (String(row.owner_id) !== userId) return ok({ error: "ownership mismatch" }, 403)

  const current = sanitizeCaptionsArray(row.captions)
  const next = current.filter((entry) => entry.language !== language)
  if (next.length === current.length) {
    return ok({ ok: true, captions: current })
  }

  const { error: updErr } = await db.from("files").update({ captions: next }).eq("id", fileId)
  if (updErr) {
    console.error("[internal/captions/uncommit] update:", updErr)
    return ok({ error: "update failed" }, 500)
  }
  return ok({ ok: true, captions: next })
}

function sanitizeCaptionsArray(raw: unknown): CaptionEntry[] {
  if (!Array.isArray(raw)) return []
  const out: CaptionEntry[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const lang = typeof e.language === "string" ? e.language.trim() : ""
    const path = typeof e.path === "string" ? e.path.trim() : ""
    if (!lang || !path) continue
    out.push({ language: lang, path })
  }
  return out
}
