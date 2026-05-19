/**
 * requestGuard.server.ts
 *
 * Blocks the easy categories of cookie-replay attacks:
 *   - Postman / curl / scripted clients trying to replay a stolen cookie
 *   - Cross-site requests forging a same-origin-looking call
 *   - Headless clients that "forgot" to lie about being a browser
 *
 * Real browsers automatically attach `Sec-Fetch-*` headers per
 * https://www.w3.org/TR/fetch-metadata/ — Postman / curl don't, and they
 * can't be set from JavaScript (they're in the `forbidden header` list).
 * That makes them the single best "is this a real browser?" signal we
 * can rely on without paid services.
 *
 * Combined with an `Origin` allowlist and a sanity check on User-Agent
 * (must look like a browser, must not be empty), the guard rejects the
 * majority of replayable attacks without breaking legitimate users.
 *
 * Usage in a loader / action:
 *   const blocked = assertSafeRequest(request);
 *   if (blocked) return blocked;
 *
 * For endpoints intentionally callable cross-site (RSS, webhooks, etc.)
 * pass { allowCrossSite: true } or { allowMissingSecFetch: true }.
 */

const ALLOWED_ORIGINS = new Set<string>([
  // Production
  "https://memories.brozy.org",
  "https://uploads.memories.brozy.org",
  // Local dev — react-router default
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

// Extra origins from env (comma separated). Lets you deploy to a preview
// URL without recompiling.
const extraOrigins = (process.env.EXTRA_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
for (const o of extraOrigins) ALLOWED_ORIGINS.add(o);

/** Headers a browser cannot fake from JavaScript. */
const SEC_FETCH_SITE = "sec-fetch-site";
const SEC_FETCH_MODE = "sec-fetch-mode";
const SEC_FETCH_DEST = "sec-fetch-dest";

/** Sec-Fetch-Site values we trust for authenticated API calls. */
const SAME_ORIGIN_SITE_VALUES = new Set(["same-origin", "same-site"]);

export interface RequestGuardOptions {
  /** Allow cross-site `Sec-Fetch-Site` values. Default false. */
  allowCrossSite?: boolean;
  /**
   * Allow requests that don't include Sec-Fetch-* headers at all.
   * Defaults to false for authenticated APIs. Older clients / non-secure
   * contexts (rare) may need this — but it's the killer flag for Postman
   * so flip it sparingly.
   */
  allowMissingSecFetch?: boolean;
  /** Skip the Origin allowlist check. Default false. */
  allowAnyOrigin?: boolean;
  /** Skip the User-Agent sanity check. Default false. */
  allowEmptyUA?: boolean;
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Returns null when the request looks like it came from a real browser
 * in our origin. Returns a `Response` (403) when something's wrong, ready
 * to be returned directly from the route handler.
 */
export function assertSafeRequest(
  request: Request,
  options: RequestGuardOptions = {},
): Response | null {
  const h = request.headers;
  const method = request.method.toUpperCase();

  // 1. Sec-Fetch-* — Postman / curl / cross-site fetches fail here.
  //    A real browser ALWAYS sends Sec-Fetch-Site on every fetch.
  const sfSite = h.get(SEC_FETCH_SITE)?.toLowerCase() ?? null;
  if (!sfSite) {
    if (!options.allowMissingSecFetch) {
      return jsonResponse(403, { error: "Forbidden: bad fetch metadata" });
    }
  } else if (!options.allowCrossSite && !SAME_ORIGIN_SITE_VALUES.has(sfSite)) {
    // Browser navigations from a bookmark / typed URL come in as
    // "none" — we explicitly do NOT allow that for APIs because no API
    // should be hit directly from the address bar.
    return jsonResponse(403, { error: "Forbidden: cross-site request" });
  }

  // 2. Sec-Fetch-Mode + Sec-Fetch-Dest — defensive. We want CORS-style
  //    fetches with empty dest (XHR / fetch), or navigations with
  //    "document" dest. Anything else (object, embed, iframe) is sus.
  const sfMode = h.get(SEC_FETCH_MODE)?.toLowerCase();
  const sfDest = h.get(SEC_FETCH_DEST)?.toLowerCase();
  if (sfMode && !["cors", "navigate", "same-origin", "no-cors"].includes(sfMode)) {
    return jsonResponse(403, { error: "Forbidden: bad fetch mode" });
  }
  if (sfDest && !["empty", "document", "iframe"].includes(sfDest)) {
    return jsonResponse(403, { error: "Forbidden: bad fetch dest" });
  }

  // 3. Origin allowlist — for state-changing methods especially.
  if (!options.allowAnyOrigin) {
    const origin = h.get("origin");
    if (origin) {
      if (!ALLOWED_ORIGINS.has(origin)) {
        return jsonResponse(403, { error: "Forbidden: origin" });
      }
    } else if (
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS"
    ) {
      // POST/PUT/PATCH/DELETE without Origin is suspicious — every
      // browser sends Origin for these in modern versions.
      return jsonResponse(403, { error: "Forbidden: missing origin" });
    }
  }

  // 4. User-Agent sanity — must be present and look browser-ish.
  //    Postman sends "PostmanRuntime/...". curl sends "curl/...". Both
  //    can be spoofed, so this is the weakest layer; #1 is the real
  //    defense. We just block the obvious tools as defense-in-depth.
  if (!options.allowEmptyUA) {
    const ua = h.get("user-agent") ?? "";
    if (ua.length < 8) {
      return jsonResponse(403, { error: "Forbidden: bad user agent" });
    }
    const lowerUA = ua.toLowerCase();
    if (
      lowerUA.includes("postmanruntime") ||
      lowerUA.includes("insomnia/") ||
      lowerUA.startsWith("curl/") ||
      lowerUA.startsWith("wget/") ||
      lowerUA.startsWith("python-requests/") ||
      lowerUA.includes("httpie/") ||
      lowerUA.includes("go-http-client")
    ) {
      return jsonResponse(403, { error: "Forbidden: tool detected" });
    }
  }

  return null;
}

/** Re-export for testing / introspection. */
export const __ALLOWED_ORIGINS = ALLOWED_ORIGINS;
