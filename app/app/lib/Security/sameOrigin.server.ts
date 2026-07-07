/**
 * Same-origin guard for state-changing API calls (CSRF defense in depth).
 *
 * Reconstructs the public origin from proxy headers, then requires the request's
 * Origin (or Referer, when Origin is absent) to match it. A cross-site page can
 * send the auth cookie but cannot forge a matching Origin, so this blocks CSRF
 * even if the session cookie is not SameSite. Mirrors the inline checks used by
 * the play mint routes, kept here so mutating endpoints can share one copy.
 */

function expectedOrigin(request: Request): string {
  const fwdHost = request.headers.get("X-Forwarded-Host") ?? "";
  const host = request.headers.get("Host") ?? "";
  const publicHost = fwdHost || host;
  if (!publicHost) {
    try {
      return new URL(request.url).origin;
    } catch {
      return "";
    }
  }
  const fwdProto = request.headers.get("X-Forwarded-Proto") ?? "";
  const proto = fwdProto || (request.url.startsWith("https://") ? "https" : "http");
  return `${proto}://${publicHost}`;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin") ?? "";
  const referer = request.headers.get("Referer") ?? "";
  const expected = expectedOrigin(request);
  if (!expected) return false;
  if (origin && origin !== expected) return false;
  // No Origin AND no Referer is not a real browser fetch — reject.
  if (!origin && !referer) return false;
  if (referer) {
    try {
      if (new URL(referer).origin !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}
