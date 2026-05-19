/**
 * requestSignature.server.ts
 *
 * HMAC request-signing: defends against stolen-cookie REPLAY when the
 * attacker doesn't have access to the user's browser JS context.
 *
 * Flow:
 *   1. After auth, browser asks `/api/handshake/sig-key` for its key.
 *      The handshake itself is guarded by `assertSafeRequest`, so a
 *      cookie-only attacker (Postman) can't fetch the key.
 *   2. Browser stores the key in `sessionStorage` (per-tab, JS-only).
 *   3. Every authenticated API call ships:
 *        - `X-Sig`     = base64url(HMAC_SHA256(key, payload))
 *        - `X-Sig-Ts`  = unix ms timestamp
 *      where payload = `<TS>\n<METHOD>\n<PATH>\n<sha256(body) hex>`.
 *   4. Server re-derives the key, recomputes the HMAC, compares
 *      constant-time. Rejects if mismatch or stale timestamp.
 *
 * The signing key is derived deterministically from the cookie value +
 * a server-side master secret (env: `REQUEST_SIG_SECRET`). That keeps
 * us stateless — no Redis lookup per request — while still being
 * unguessable without both halves.
 */

import { createHmac, createHash, timingSafeEqual, randomBytes } from "crypto";

/** Generate a master secret on boot if none is provided. Logs a warning
 *  so the operator knows to set it in env for cross-process consistency
 *  (multiple nodes need the same secret to validate each other's keys). */
const ENV_SECRET = process.env.REQUEST_SIG_SECRET;
const MASTER_SECRET: Buffer = ENV_SECRET
  ? Buffer.from(ENV_SECRET, "utf8")
  : (() => {
      const b = randomBytes(32);
      if (process.env.NODE_ENV === "production") {
        console.warn(
          "[requestSignature] REQUEST_SIG_SECRET not set — generated a random one. " +
            "Multi-process deploys will reject each other's signatures. Set this env var.",
        );
      }
      return b;
    })();

/** Replay window — requests older than this are rejected even with a
 *  valid signature. 30s is generous for clock skew + slow networks. */
const REPLAY_WINDOW_MS = 30_000;

/** Domain-separation tag baked into the derivation so the key can't be
 *  reused for a different purpose elsewhere in the codebase. */
const HKDF_INFO = Buffer.from("memories-request-sig-v1", "utf8");

/**
 * Derives the per-cookie signing key. Same cookie → same key, so we
 * never need to store anything.
 */
export function deriveSigningKey(cookieValue: string): Buffer {
  // Plain HMAC-as-PRF is fine here (we don't need full HKDF for a single
  // 32-byte output). Equivalent to HKDF-Extract with a deterministic salt.
  return createHmac("sha256", MASTER_SECRET)
    .update(HKDF_INFO)
    .update(Buffer.from(cookieValue, "utf8"))
    .digest();
}

/** Same key, base64url-encoded for transport to the browser. */
export function deriveSigningKeyBase64Url(cookieValue: string): string {
  return deriveSigningKey(cookieValue).toString("base64url");
}

/** Hash a request body for inclusion in the signed payload. Empty body
 *  produces a stable known hash so the signed string is unambiguous. */
function hashBody(bodyBytes: Uint8Array | null): string {
  const h = createHash("sha256");
  if (bodyBytes && bodyBytes.length > 0) h.update(bodyBytes);
  return h.digest("hex");
}

/**
 * Compose the canonical bytes the client signs. Server and client MUST
 * produce the exact same string for the HMAC to match.
 *
 * Path is taken from the URL's pathname + search (so query params are
 * authenticated). We do NOT include host — that's already implied by
 * the Origin check elsewhere.
 */
function canonicalPayload(
  timestampMs: string,
  method: string,
  pathAndQuery: string,
  bodyHashHex: string,
): string {
  return `${timestampMs}\n${method.toUpperCase()}\n${pathAndQuery}\n${bodyHashHex}`;
}

export interface SignatureValidationOptions {
  /** The cookie value (already pulled via getCookie / Token util). */
  cookieValue: string;
  /**
   * Raw body bytes, if any. Caller must pass a Uint8Array; we hash it
   * and feed into the canonical payload. Pass null for GET / HEAD.
   *
   * The reason this is bytes (not a parsed JSON body): the client signs
   * the exact bytes it sent, so we can't re-stringify-then-hash without
   * risking a mismatch on whitespace / key ordering.
   */
  bodyBytes?: Uint8Array | null;
}

export interface SignatureValidationResult {
  valid: boolean;
  /** Failure reason — useful for logging, never echo to the client. */
  reason?: string;
}

/**
 * Verifies the request's HMAC against the derived key.
 *
 * Caller is responsible for having authenticated the user first. This
 * function only validates that whoever sent the request also possessed
 * the signing key (i.e., went through the handshake from a real browser).
 */
export function validateRequestSignature(
  request: Request,
  options: SignatureValidationOptions,
): SignatureValidationResult {
  const sig = request.headers.get("x-sig");
  const tsHeader = request.headers.get("x-sig-ts");

  if (!sig || !tsHeader) {
    return { valid: false, reason: "missing_sig_headers" };
  }

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { valid: false, reason: "bad_ts" };
  }
  const now = Date.now();
  if (Math.abs(now - ts) > REPLAY_WINDOW_MS) {
    return { valid: false, reason: "stale_ts" };
  }

  const url = new URL(request.url);
  const pathAndQuery = `${url.pathname}${url.search}`;
  const bodyHash = hashBody(options.bodyBytes ?? null);
  const payload = canonicalPayload(tsHeader, request.method, pathAndQuery, bodyHash);

  const key = deriveSigningKey(options.cookieValue);
  const expected = createHmac("sha256", key).update(payload).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return { valid: false, reason: "bad_sig_b64" };
  }
  if (provided.length !== expected.length) {
    return { valid: false, reason: "len_mismatch" };
  }
  if (!timingSafeEqual(provided, expected)) {
    return { valid: false, reason: "hmac_mismatch" };
  }
  return { valid: true };
}

/**
 * Convenience: read the body once for both signature validation and the
 * route handler. Returns the bytes plus a `bodyText()` helper so the
 * route doesn't have to clone the request.
 */
export async function readBodyForSigning(request: Request): Promise<{
  bytes: Uint8Array;
  text(): string;
  json<T = unknown>(): T;
}> {
  if (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "OPTIONS"
  ) {
    const empty = new Uint8Array(0);
    return {
      bytes: empty,
      text: () => "",
      json: <T,>() => undefined as unknown as T,
    };
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  return {
    bytes: buf,
    text: () => new TextDecoder().decode(buf),
    json: <T,>() => JSON.parse(new TextDecoder().decode(buf)) as T,
  };
}
