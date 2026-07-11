/**
 * Soft device bind for `c_user` sessions: hash of User-Agent.
 * IP is intentionally NOT bound (mobile networks rotate).
 * Legacy tokens without `ua` still work until the user re-logs in.
 */

import { createHash } from "node:crypto";

export function sessionUaFingerprint(headers: Headers): string {
  const ua = (headers.get("user-agent") ?? "").replace(/\s+/g, "");
  return createHash("sha256").update(ua).digest("base64url").slice(0, 24);
}

/** Returns false when the token carries a UA bind that does not match this request. */
export function sessionUaMatches(
  decoded: { ua?: unknown } | null | undefined,
  headers: Headers,
): boolean {
  if (!decoded || typeof decoded.ua !== "string" || !decoded.ua) {
    // Legacy session — accept until re-issue.
    return true;
  }
  return decoded.ua === sessionUaFingerprint(headers);
}
