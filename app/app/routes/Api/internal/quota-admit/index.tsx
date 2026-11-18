import { admitUpload, releaseUploadAdmission } from "~/lib/uploadQuota.server";
import { isValidUUID } from "~/lib/Security/inputValidation";
import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server";

// POST /api/internal/quota-admit, called by the upload server at /complete.
// Body: { action: "admit" | "release", user_id, upload_id, bytes? }
// Auth: X-Webhook-Secret == UPLOAD_WEBHOOK_SECRET.
// admit answers { ok, used, limit, remaining }, or 503 when usage is unknown,
// so the upload server refuses rather than letting an unchecked upload in.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/;
// The upload server's own per file ceiling is 10 GiB; anything far past it is
// not a real upload.
const MAX_ADMIT_BYTES = 100 * 1024 * 1024 * 1024;

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!verifyWebhookSecret(request)) return json({ error: "unauthorized" }, 401);

  let body: { action?: unknown; user_id?: unknown; upload_id?: unknown; bytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const uploadId = typeof body.upload_id === "string" ? body.upload_id : "";
  if (!isValidUUID(userId) || !UPLOAD_ID_PATTERN.test(uploadId)) return json({ error: "invalid" }, 400);

  if (body.action === "release") {
    const ok = await releaseUploadAdmission(userId, uploadId);
    return ok ? json({ ok: true }) : json({ error: "unavailable" }, 503);
  }
  if (body.action !== "admit") return json({ error: "invalid" }, 400);

  const bytes = body.bytes;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_ADMIT_BYTES) {
    return json({ error: "invalid" }, 400);
  }

  const res = await admitUpload(userId, uploadId, bytes);
  if (res.ok) return json({ ok: true, used: res.used, limit: res.limit, remaining: res.remaining });
  if (res.reason === "limit") {
    return json({ ok: false, used: res.used, limit: res.limit, remaining: res.remaining });
  }
  if (res.reason === "invalid") return json({ error: "invalid" }, 400);
  return json({ error: "unavailable" }, 503);
};

export const loader = () => json({ error: "method not allowed" }, 405);
