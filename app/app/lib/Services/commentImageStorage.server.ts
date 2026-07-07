/**
 * App -> GoUpload /internal/comment-image/delete (X-Webhook-Secret, server-to-
 * server only). Purges a single comment image when its comment is deleted. The
 * app holds no GitHub token, so GitHub deletes must go through the upload
 * server; R2 is deleted in-app directly. Fail-closed: returns false when the
 * upload server or secret is missing.
 */

const DELETE_TIMEOUT_MS = 10_000;

export async function deleteCommentImageFromStorage(
  path: string,
  repo: string,
  backend: "github" | "r2",
): Promise<boolean> {
  const base = (process.env.UPLOAD_SERVER_URL || process.env.GO_UPLOAD_URL || "").replace(/\/$/, "");
  const secret = process.env.UPLOAD_WEBHOOK_SECRET || "";
  if (!base || !secret || !path) return false;
  if (backend === "github" && !repo) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/internal/comment-image/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify({ path, backend, ...(backend === "github" ? { repo } : {}) }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
