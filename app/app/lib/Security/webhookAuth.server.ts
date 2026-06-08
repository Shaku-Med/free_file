import crypto from "node:crypto";

// Constant-time equality. Length is compared first (cheap, and timingSafeEqual
// throws on length mismatch), then the bytes. Defends webhook-secret checks
// against timing side-channels.
export function timingSafeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Pulls the secret from X-Webhook-Secret or `Authorization: Bearer <secret>`.
function extractSecret(request: Request): string {
  const direct = request.headers.get("X-Webhook-Secret");
  if (direct) return direct.trim();
  const auth = request.headers.get("Authorization");
  if (auth) return auth.replace(/^Bearer\s+/i, "").trim();
  return "";
}

/**
 * Verify a server-to-server webhook secret in constant time.
 * Returns true only when UPLOAD_WEBHOOK_SECRET is set AND matches.
 */
export function verifyWebhookSecret(request: Request): boolean {
  const expected =
    typeof process !== "undefined" ? process.env?.UPLOAD_WEBHOOK_SECRET ?? "" : "";
  if (!expected) return false;
  const provided = extractSecret(request);
  if (!provided) return false;
  return timingSafeEqualStr(provided, expected);
}
