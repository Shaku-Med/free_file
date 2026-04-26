/**
 * Hardens video endpoints against pasted-URL theft and curl/ffmpeg ripping by
 * requiring browser-set Sec-Fetch headers consistent with an in-app fetch.
 * Sec-Fetch-* are set by the user agent and cannot be overridden by JS, so
 * a request opened in a new tab (`Sec-Fetch-Dest: document`,
 * `Sec-Fetch-Site: none`) is always distinguishable from hls.js / native
 * <video> requests originating inside the app.
 */

/**
 * Browser origins allowed for video / manifest CORS + `videoRequestGuard`.
 * Same host may use http or https (e.g. TLS terminator); matching is by host.
 * Add local dev URLs as needed.
 */
export const ALLOWED_APP_ORIGINS = [
  "https://memories.brozy.org",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

function allowlistHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const entry of ALLOWED_APP_ORIGINS) {
    try {
      hosts.add(new URL(entry).host);
    } catch {
      /* skip bad entry */
    }
  }
  return hosts;
}

const _allowlistHosts = allowlistHosts();

/** Request `Origin` header is allowed if its host matches any entry in {@link ALLOWED_APP_ORIGINS}. */
export function originMatchesAllowlist(originHeader: string | null): boolean {
  if (!originHeader) return false;
  try {
    const host = new URL(originHeader).host;
    return _allowlistHosts.has(host);
  } catch {
    return false;
  }
}

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

/**
 * Origin the browser uses (HTTPS) when Node only sees `http://` behind a TLS-terminating proxy.
 * Uses `X-Forwarded-Proto` + `X-Forwarded-Host` when present.
 */
export function inferPublicOriginFromRequest(
  requestUrl: URL,
  headers: Headers
): string {
  const xfProto = headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const xfHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = xfHost || headers.get("host") || requestUrl.host;

  if (host && (xfProto === "https" || xfProto === "http")) {
    return `${xfProto}://${host}`;
  }

  return requestUrl.origin;
}

function isOriginAllowed(headers: Headers, requestUrl: URL): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;

  if (originMatchesAllowlist(origin)) return true;

  const publicOrigin = inferPublicOriginFromRequest(requestUrl, headers);
  if (originMatchesAllowlist(publicOrigin)) return true;
  if (origin === publicOrigin) return true;
  if (origin === requestUrl.origin) return true;

  // TLS terminator: browser Origin is https://host, Node `request.url` is http://host
  try {
    const o = new URL(origin);
    const internal = new URL(requestUrl);
    if (o.hostname === internal.hostname) {
      if (o.protocol === "https:" && internal.protocol === "http:") return true;
      if (o.protocol === internal.protocol) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * CORS `Access-Control-Allow-Origin` for credentialed responses: must echo the
 * request Origin when it is allowlisted; otherwise infer from forwarding headers.
 */
export function getAllowedOrigin(requestUrl: URL, headers?: Headers): string {
  const origin = headers?.get("origin");
  if (origin && originMatchesAllowlist(origin)) {
    return origin;
  }
  if (headers) {
    const inferred = inferPublicOriginFromRequest(requestUrl, headers);
    if (originMatchesAllowlist(inferred)) {
      return inferred;
    }
  }
  return ALLOWED_APP_ORIGINS[0] ?? requestUrl.origin;
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
    const inferred = inferPublicOriginFromRequest(url, h);
    return {
      ok: false,
      reason: `origin: Origin=${origin ?? "(missing)"} allowlistHosts=[${[..._allowlistHosts].join(", ")}] requestUrl.origin=${url.origin} inferredPublic=${inferred}`,
    };
  }
  return { ok: true };
}

export function videoRequestGuard(request: Request): boolean {
  return evaluateVideoRequestGuard(request).ok;
}
