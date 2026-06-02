import { recordUploadUsage } from "~/lib/uploadQuota.server";
import { isValidUUID } from "~/lib/Security/inputValidation";

// Belt-and-suspenders cap on a single recorded upload even if the webhook
// secret leaks. 100 GiB is well above any legitimate upload (per-file ceiling
// is 10 GiB). Keeps a compromised caller from instantly maxing a user's
// quota across years.
const MAX_RECORDABLE_BYTES = 100 * 1024 * 1024 * 1024;

// POST /api/internal/quota-record  webhook-secret-authed call from the Go
// upload server after a profile pic / comment image / custom thumbnail /
// caption finishes uploading. Records bytes against the user's weekly budget.
//
// Body: { user_id, upload_id, bytes }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const secret =
    request.headers.get("X-Webhook-Secret") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  const expected = typeof process !== "undefined" ? process.env?.UPLOAD_WEBHOOK_SECRET : "";
  if (!expected || secret !== expected) return json({ error: "unauthorized" }, 401);

  let body: { user_id?: unknown; upload_id?: unknown; bytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const uploadId = typeof body.upload_id === "string" ? body.upload_id.trim().slice(0, 200) : "";
  const bytesRaw = typeof body.bytes === "number" ? body.bytes : Number(body.bytes);
  let bytes = Number.isFinite(bytesRaw) && bytesRaw >= 0 ? Math.floor(bytesRaw) : 0;
  if (bytes > MAX_RECORDABLE_BYTES) bytes = MAX_RECORDABLE_BYTES;
  if (!userId || !isValidUUID(userId) || !uploadId) return json({ error: "invalid" }, 400);
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(uploadId)) return json({ error: "invalid" }, 400);

  await recordUploadUsage(userId, uploadId, bytes);
  return json({ ok: true });
};

export const loader = () => json({ error: "method not allowed" }, 405);
