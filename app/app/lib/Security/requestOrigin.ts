/**
 * Origin-based CSRF guard for state-changing form POSTs (login, signup, reset,
 * verify). Complements the `SameSite=Lax` session cookie with an explicit block.
 *
 * Design goal: add real protection WITHOUT breaking any legitimate client.
 *  - Modern browsers ALWAYS send `Origin` on same-origin state-changing POSTs,
 *    so a genuine request from our own pages carries a matching Origin.
 *  - A cross-site CSRF page auto-submitting to us carries the ATTACKER's origin.
 *  - Native / desktop / privacy-hardened clients may send no Origin at all.
 *
 * So we reject ONLY when an Origin is present, is a real web origin, and does
 * NOT match ours. Absent Origin (or a non-http scheme) is allowed — those are
 * not browser-CSRF vectors, and SameSite already guards the cookie there.
 */

function expectedOrigin(request: Request): string {
  const fwdHost = request.headers.get("X-Forwarded-Host") ?? "";
  const host = request.headers.get("Host") ?? "";
  const publicHost = fwdHost.split(",")[0].trim() || host;
  if (!publicHost) {
    try {
      return new URL(request.url).origin;
    } catch {
      return "";
    }
  }
  const fwdProto = (request.headers.get("X-Forwarded-Proto") ?? "").split(",")[0].trim();
  const proto = fwdProto || (request.url.startsWith("https://") ? "https" : "http");
  return `${proto}://${publicHost}`.toLowerCase();
}

/**
 * True when the request is a browser POST from a DIFFERENT web origin — i.e. a
 * cross-site request forgery attempt. Callers should reject with 403.
 */
export function isCrossOriginForgery(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin || !/^https?:\/\//i.test(origin)) {
    // No Origin, or a non-web scheme (native app) — not a browser CSRF vector.
    return false;
  }
  const expected = expectedOrigin(request);
  if (!expected) return false; // can't determine our own origin → don't block
  return origin.toLowerCase() !== expected;
}
