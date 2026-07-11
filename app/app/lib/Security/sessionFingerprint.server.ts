// Soft UA bind for c_user sessions; IP is not bound (mobile networks rotate).

import { createHash } from "node:crypto";

export function sessionUaFingerprint(headers: Headers): string {
  const ua = (headers.get("user-agent") ?? "").replace(/\s+/g, "");
  return createHash("sha256").update(ua).digest("base64url").slice(0, 24);
}

export function sessionUaMatches(
  decoded: { ua?: unknown } | null | undefined,
  headers: Headers,
): boolean {
  // Legacy sessions without a ua claim stay valid until re-login.
  if (!decoded || typeof decoded.ua !== "string" || !decoded.ua) {
    return true;
  }
  return decoded.ua === sessionUaFingerprint(headers);
}
