import { defaultGithubBranch, githubRawFileUrl } from "~/lib/githubStorage"
import { MAX_VTT_BYTES } from "~/lib/captions/server"
import db from "~/lib/Database/supabase"
import { r2PresignGet } from "~/lib/r2.server"

const FETCH_TIMEOUT_MS = 8000
const SAFE_PATH_RE = /^[A-Za-z0-9._\-/]{1,256}$/
const PREFIX = "/api/load/vtt/"
const MAX_TOKEN_LENGTH = 256

const errorResponse = (status: number) =>
  new Response(JSON.stringify({ error: "Forbidden" }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })

export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url)

  const token = (
    request.headers.get("X-Caption-Token") ||
    url.searchParams.get("t") ||
    ""
  ).trim()
  if (!token || token.length > MAX_TOKEN_LENGTH) return errorResponse(403)

  const idx = url.pathname.indexOf(PREFIX)
  const requestedPath =
    idx >= 0 ? decodeURIComponent(url.pathname.slice(idx + PREFIX.length)).trim() : ""
  if (
    !requestedPath ||
    !SAFE_PATH_RE.test(requestedPath) ||
    requestedPath.includes("..") ||
    !requestedPath.endsWith(".vtt")
  ) {
    return errorResponse(400)
  }

  if (!db) return errorResponse(503)

  const { data: rows, error } = await db.rpc("consume_caption_load_token", {
    p_token: token,
  })
  if (error) {
    console.error("[load-vtt] consume:", error)
    return errorResponse(500)
  }
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row || typeof row !== "object") return errorResponse(403)

  if (row.path !== requestedPath) return errorResponse(403)

  // New captions are always on R2, even for a video still stored on GitHub, so
  // R2 is tried first and GitHub only holds captions from before the move.
  const candidates: string[] = []
  const signed = r2PresignGet(row.path)
  if (signed) candidates.push(signed)
  if (row.storage_backend !== "r2") {
    const owner = process.env.GITHUB_OWNER
    if (owner && typeof row.github_repo === "string" && row.github_repo) {
      candidates.push(githubRawFileUrl(owner, row.github_repo, defaultGithubBranch(), row.path))
    }
  }
  if (candidates.length === 0) return errorResponse(503)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    let res: Response | null = null
    for (const rawUrl of candidates) {
      const attempt = await fetch(rawUrl, { signal: ctrl.signal })
      if (attempt.ok) {
        res = attempt
        break
      }
      await attempt.body?.cancel()
    }
    if (!res) return errorResponse(404)

    const lengthHeader = res.headers.get("content-length")
    if (lengthHeader && Number(lengthHeader) > MAX_VTT_BYTES) {
      return errorResponse(413)
    }

    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_VTT_BYTES) return errorResponse(413)

    return new Response(new TextDecoder("utf-8").decode(buf), {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    })
  } catch {
    return errorResponse(502)
  } finally {
    clearTimeout(timer)
  }
}
