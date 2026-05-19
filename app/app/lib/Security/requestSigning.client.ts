/**
 * requestSigning.client.ts
 *
 * Browser-side helper that:
 *   1. Lazily fetches the per-session signing key from `/api/handshake/sig-key`.
 *      That endpoint requires a valid cookie + browser-shape headers, so a
 *      cookie-only attacker (Postman, curl) can't ever get this key.
 *   2. Caches the key in `sessionStorage` — per-tab, JS-only. Cleared on
 *      browser close.
 *   3. Exposes `signedFetch(...)` — drop-in replacement for `fetch` that
 *      adds `X-Sig` + `X-Sig-Ts` to every call. Use this for any
 *      authenticated API request.
 *
 * If the handshake fails (logged out, network down), we still issue the
 * request without a signature; the server will then 401, which is the
 * correct outcome.
 */

const SIG_KEY_STORAGE = "memories.sigKey.v1";
const SIG_KEY_HANDSHAKE_URL = "/api/handshake/sig-key";

let cachedKey: CryptoKey | null = null;
let cachedKeyMaterial: string | null = null;
let inflightHandshake: Promise<CryptoKey | null> | null = null;

function readStoredKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SIG_KEY_STORAGE);
  } catch {
    return null;
  }
}

function writeStoredKey(b64url: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (b64url) window.sessionStorage.setItem(SIG_KEY_STORAGE, b64url);
    else window.sessionStorage.removeItem(SIG_KEY_STORAGE);
  } catch {
    /* private mode / quota — ignore */
  }
}

function base64UrlDecode(s: string): Uint8Array {
  // Convert base64url → base64, pad, decode.
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importKey(material: string): Promise<CryptoKey | null> {
  try {
    const raw = base64UrlDecode(material);
    // SubtleCrypto.importKey wants a plain ArrayBuffer for "raw". Pull
    // out the underlying buffer slice to satisfy the type checker.
    return await crypto.subtle.importKey(
      "raw",
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    return null;
  }
}

async function fetchKeyFromServer(): Promise<string | null> {
  try {
    const res = await fetch(SIG_KEY_HANDSHAKE_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { key?: string };
    if (typeof data.key !== "string" || data.key.length < 16) return null;
    return data.key;
  } catch {
    return null;
  }
}

/**
 * Resolves to the current session's HMAC signing key, fetching it via
 * the handshake endpoint on first use. Caches across calls within a tab.
 * Returns null if the handshake fails — caller should still issue the
 * request and let the server return 401.
 */
async function getSigningKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  if (inflightHandshake) return inflightHandshake;

  inflightHandshake = (async () => {
    let material = readStoredKey();
    if (!material) {
      material = await fetchKeyFromServer();
      if (material) writeStoredKey(material);
    }
    if (!material) return null;
    const k = await importKey(material);
    if (k) {
      cachedKey = k;
      cachedKeyMaterial = material;
    }
    return k;
  })();

  try {
    return await inflightHandshake;
  } finally {
    inflightHandshake = null;
  }
}

/**
 * Force-rotates the signing key (handshake + re-cache). Call this after
 * login, account switch, or when you receive an `X-Sig-Stale` response.
 */
export async function rotateSigningKey(): Promise<void> {
  cachedKey = null;
  cachedKeyMaterial = null;
  writeStoredKey(null);
  await getSigningKey();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0) {
    // Constant: sha256 of the empty string.
    return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  }
  const slice = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const buf = await crypto.subtle.digest("SHA-256", slice);
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += b[i].toString(16).padStart(2, "0");
  }
  return s;
}

async function signCanonical(
  key: CryptoKey,
  timestamp: string,
  method: string,
  pathAndQuery: string,
  bodyHashHex: string,
): Promise<string> {
  const payload = `${timestamp}\n${method.toUpperCase()}\n${pathAndQuery}\n${bodyHashHex}`;
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return base64UrlEncode(sigBuf);
}

function pathAndQueryFromUrl(input: string | URL | Request): string {
  if (input instanceof Request) input = input.url;
  // Allow relative URLs ("/api/foo") — pretend they're on the current origin.
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const u = typeof input === "string" ? new URL(input, base) : input;
  return `${u.pathname}${u.search}`;
}

async function readBodyBytes(init?: RequestInit): Promise<Uint8Array> {
  if (!init || init.body == null) return new Uint8Array(0);
  const b = init.body;
  if (typeof b === "string") return new TextEncoder().encode(b);
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (b instanceof Blob) return new Uint8Array(await b.arrayBuffer());
  if (b instanceof FormData) {
    // FormData isn't deterministically serialisable, so we'd have to
    // intercept it. Skip signing for FormData payloads — callers should
    // prefer JSON for authenticated calls. The server should also skip
    // the signature check for multipart uploads (file streams).
    return new Uint8Array(0);
  }
  if (b instanceof URLSearchParams) return new TextEncoder().encode(b.toString());
  // ReadableStream — also not signable in advance.
  return new Uint8Array(0);
}

/**
 * Drop-in replacement for `fetch` that adds X-Sig + X-Sig-Ts. Always
 * sends credentials (include cookies) and lets you pass everything else
 * through unchanged.
 *
 * If the signature key isn't available, issues the request unsigned —
 * the server will 401. We don't pre-empt because the caller has no way
 * to recover from a hard rejection here.
 */
export async function signedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);

  // Always include cookies for authenticated APIs unless caller overrode.
  const credentials: RequestCredentials = init?.credentials ?? "include";

  const key = await getSigningKey();
  if (key) {
    const ts = Date.now().toString();
    const path = pathAndQueryFromUrl(
      input instanceof Request ? input.url : (input as string | URL),
    );
    const bodyBytes = await readBodyBytes(init);
    const bodyHash = await sha256Hex(bodyBytes);
    const sig = await signCanonical(key, ts, method, path, bodyHash);
    headers.set("X-Sig", sig);
    headers.set("X-Sig-Ts", ts);
  }

  const res = await fetch(input, { ...init, headers, credentials });

  // On 401 with a hint that the signature was stale (e.g. server
  // rotated the master secret), try once more with a fresh handshake.
  if (res.status === 401 && res.headers.get("x-sig-stale") === "1") {
    await rotateSigningKey();
    return fetch(input, { ...init, headers, credentials });
  }

  return res;
}

/** Test-only — exposes the cached material so tests can confirm caching. */
export const __test = {
  getCachedMaterial: () => cachedKeyMaterial,
  resetForTests: () => {
    cachedKey = null;
    cachedKeyMaterial = null;
    inflightHandshake = null;
    writeStoredKey(null);
  },
};
