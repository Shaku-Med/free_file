import { data } from "react-router"
import db from "~/lib/Database/supabase"
import { isValidUUID } from "~/lib/Security/inputValidation"
import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server"
import { MAX_LANGUAGES_PER_FILE } from "~/lib/captions/server"
import { SUPPORTED_LANGUAGES } from "~/lib/captions/vtt"
import { sanitizeStoredCaptions, type StoredCaption } from "~/lib/captions/entries.server"
import { isStillProcessing } from "~/lib/files/uploadStatus"

/**
 * GoUpload → app: a caption track made from an upload's speech. It is added
 * as the auto generated track for its language unless the owner already has
 * captions there. 4xx answers are final (GoUpload deletes the file it stored);
 * 5xx answers are retried.
 */

const ok = (body: unknown, status = 200) =>
  data(body, { status, headers: { "Cache-Control": "no-store" } })

const UPLOAD_ID_RE = /^[a-f0-9]{32}$/
const SUPPORTED = new Set(SUPPORTED_LANGUAGES.map((l) => l.code))

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return ok({ error: "Method not allowed" }, 405)
  if (!verifyWebhookSecret(request)) return ok({ error: "unauthorized" }, 401)
  if (!db) return ok({ error: "unavailable" }, 503)

  let body: { upload_id?: unknown; user_id?: unknown; language?: unknown; path?: unknown }
  try {
    body = await request.json()
  } catch {
    return ok({ error: "invalid json" }, 400)
  }

  const uploadId = typeof body.upload_id === "string" ? body.upload_id.trim() : ""
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : ""
  const language = typeof body.language === "string" ? body.language.trim() : ""
  const path = typeof body.path === "string" ? body.path.trim() : ""

  if (!UPLOAD_ID_RE.test(uploadId)) return ok({ error: "invalid upload_id" }, 400)
  if (!isValidUUID(userId)) return ok({ error: "invalid user_id" }, 400)
  if (!SUPPORTED.has(language)) return ok({ error: "unsupported language" }, 422)
  // Only ever this upload's own folder, under the auto track's own name.
  const expectedPath = new RegExp(`^\\d{2}_\\d{2}_\\d{4}/${uploadId}/captions/auto-${language}\\.vtt$`)
  if (!expectedPath.test(path)) return ok({ error: "invalid path" }, 400)

  const { data: row, error: fetchErr } = await db
    .from("files")
    .select("id, owner_id, upload_status, captions")
    .eq("unique_id", uploadId)
    .maybeSingle()
  if (fetchErr) {
    console.error("[internal/captions/auto] fetch:", fetchErr)
    return ok({ error: "fetch failed" }, 500)
  }
  if (!row) return ok({ error: "file not found" }, 404)
  if (String(row.owner_id) !== userId) return ok({ error: "ownership mismatch" }, 403)
  const status = typeof row.upload_status === "string" ? row.upload_status.toLowerCase() : ""
  if (status === "failed") return ok({ error: "upload failed" }, 409)
  // Its "completed" update may still be on the way: GoUpload tries again later.
  if (isStillProcessing(status)) return ok({ error: "file not ready" }, 503)

  const current = sanitizeStoredCaptions(row.captions)
  const existing = current.find((entry) => entry.language === language)
  if (existing && !existing.auto) return ok({ error: "owner captions exist" }, 409)
  const without = current.filter((entry) => entry.language !== language)
  if (without.length >= MAX_LANGUAGES_PER_FILE) return ok({ error: "language limit reached" }, 409)
  const next: StoredCaption[] = [...without, { language, path, auto: true }]

  const { error: updErr } = await db.from("files").update({ captions: next }).eq("id", row.id)
  if (updErr) {
    console.error("[internal/captions/auto] update:", updErr)
    return ok({ error: "update failed" }, 500)
  }
  return ok({ ok: true })
}
