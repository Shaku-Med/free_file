/**
 * Hardens video endpoints against pasted-URL theft and curl/ffmpeg ripping by
 * requiring browser-set Sec-Fetch headers consistent with an in-app fetch.
 * Sec-Fetch-* are set by the user agent and cannot be overridden by JS, so
 * a request opened in a new tab (`Sec-Fetch-Dest: document`,
 * `Sec-Fetch-Site: none`) is always distinguishable from hls.js / native
 * <video> requests originating inside the app.
 */

function isInAppFetch(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  const dest = headers.get("sec-fetch-dest");
  const mode = headers.get("sec-fetch-mode");
  const userInitiated = headers.get("sec-fetch-user");

  /**
   * Top-level navigations (address bar, open in new tab, clicking a raw .m3u8
   * link) use mode=navigate and Sec-Fetch-User: ?1. hls.js XHR uses mode=cors;
   * native <video> uses mode=no-cors — neither is a document navigation.
   */
  if (mode === "navigate") return false;
  if (userInitiated === "?1") return false;

  // hls.js fetch() => site=same-origin, mode=cors,  dest=empty
  // native <video> => site=same-origin, mode=no-cors, dest=video|audio
  if (site !== "same-origin") return false;
  if (dest !== "empty" && dest !== "video" && dest !== "audio") return false;
  if (dest === "empty" && mode !== "cors") return false;
  return true;
}

function isOriginAllowed(headers: Headers, requestUrl: URL): boolean {
  const origin = headers.get("origin");
  const allowed = process.env.PUBLIC_APP_ORIGIN?.trim();
  if (allowed) {
    if (!origin) return false;
    return origin === allowed;
  }
  if (!origin) return true;
  return origin === requestUrl.origin;
}

/** Single CORS origin returned to clients — never reflect the request Origin. */
export function getAllowedOrigin(requestUrl: URL): string {
  return process.env.PUBLIC_APP_ORIGIN?.trim() || requestUrl.origin;
}

/** For production debugging: why `videoRequestGuard` failed (do not log secrets). */
export function evaluateVideoRequestGuard(
  request: Request
): { ok: true } | { ok: false; reason: string } {
  const url = new URL(request.url);
  const h = request.headers;
  if (!isInAppFetch(h)) {
    return {
      ok: false,
      reason: `sec-fetch/in-app: site=${h.get("sec-fetch-site") ?? "(missing)"} mode=${h.get("sec-fetch-mode") ?? "(missing)"} dest=${h.get("sec-fetch-dest") ?? "(missing)"} user=${h.get("sec-fetch-user") ?? "(missing)"}`,
    };
  }
  if (!isOriginAllowed(h, url)) {
    const origin = h.get("origin");
    const allowed = process.env.PUBLIC_APP_ORIGIN?.trim();
    return {
      ok: false,
      reason: `origin: Origin=${origin ?? "(missing)"} PUBLIC_APP_ORIGIN=${allowed ?? "(unset)"} requestUrl.origin=${url.origin}`,
    };
  }
  return { ok: true };
}

export function videoRequestGuard(request: Request): boolean {
  return evaluateVideoRequestGuard(request).ok;
}
