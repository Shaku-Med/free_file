import { data } from "react-router"
import db from "~/lib/Database/supabase"
import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server"

const ok = (body: unknown, status = 200) =>
  data(body, { status, headers: { "Cache-Control": "no-store" } })

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return ok({ error: "Method not allowed" }, 405)

  if (!verifyWebhookSecret(request)) {
    return ok({ error: "unauthorized" }, 401)
  }

  if (!db) return ok({ error: "unavailable" }, 503)

  let body: { token?: string; expected_action?: "upload" | "delete" }
  try {
    body = await request.json()
  } catch {
    return ok({ error: "invalid json" }, 400)
  }
  const token = typeof body.token === "string" ? body.token.trim() : ""
  if (!token || token.length > 256) return ok({ error: "invalid token" }, 400)

  const { data: rows, error } = await db.rpc("consume_caption_token", { p_token: token })
  if (error) {
    console.error("[internal/captions/consume-token] rpc:", error)
    return ok({ error: "consume failed" }, 500)
  }
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row) return ok({ error: "token not found or expired" }, 404)

  if (body.expected_action && row.action !== body.expected_action) {
    return ok({ error: "action mismatch" }, 409)
  }

  return ok({
    user_id: row.user_id,
    file_id: row.file_id,
    unique_id: row.unique_id,
    date_folder: row.date_folder,
    github_repo: row.github_repo,
    storage_backend: row.storage_backend === "r2" ? "r2" : "github",
    language: row.language,
    action: row.action,
  })
}
