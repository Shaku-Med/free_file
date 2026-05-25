/**
 * POST /api/handshake/sig-key
 *
 * Returns the per-session HMAC signing key the browser uses to sign
 * subsequent authenticated API calls.
 *
 * This endpoint is the trust boundary: if it can be called from outside
 * a real browser context, the whole signing layer falls apart. So we
 * gate it with `assertSafeRequest()` (Sec-Fetch + Origin + UA sanity).
 * A Postman replay attempt is blocked HERE; it never even sees the key.
 *
 * The key itself is derived deterministically from the cookie value +
 * a server master secret. Same cookie produces the same key, so reading
 * this endpoint twice from the same session is idempotent  useful for
 * page reloads / new tabs.
 */

import { getCookie } from "~/lib/Security/Token";
import { isAuthenticated } from "~/lib/Security/Password";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";
import { deriveSigningKeyBase64Url } from "~/lib/Security/requestSignature.server";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Don't let the key sit in caches  fresh per request.
      "Cache-Control": "no-store, max-age=0",
      // Belt-and-suspenders: refuse framing of this response.
      "X-Frame-Options": "DENY",
      // Reflect-CORS-disabled  only same-origin browsers should reach this.
      "Vary": "Origin",
    },
  });

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json(405, { error: "method" });

  // 1. Browser shape  Sec-Fetch / Origin / UA. Fails Postman here.
  const blocked = assertSafeRequest(request);
  if (blocked) return blocked;

  // 2. Must already have a valid session cookie.
  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) return json(401, { error: "unauthorized" });

  // 3. Mint the key (deterministic from cookie + master secret).
  const cookieValue = getCookie("c_user", request.headers);
  if (!cookieValue) return json(401, { error: "no_session" });

  const key = deriveSigningKeyBase64Url(cookieValue);
  return json(200, { key });
};

// Reject GETs explicitly so a curl-with-cookie can't even probe.
export const loader = async () => json(405, { error: "method" });
