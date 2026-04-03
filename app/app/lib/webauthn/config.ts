/**
 * WebAuthn RP config. Prefer WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN in production
 * so passkeys work behind proxies and on the real hostname.
 *
 * WEBAUTHN_ORIGIN may be comma-separated for multiple allowed origins.
 * In dev, localhost and 127.0.0.1 are both accepted so the browser and server
 * stay in sync regardless of which URL you use.
 */
export function getWebAuthnConfig(request: Request): {
  rpID: string;
  rpName: string;
  /** Primary origin (e.g. returned to the client); use expectedOrigins for verification. */
  origin: string;
  /** Pass to verifyRegistrationResponse / verifyAuthenticationResponse as expectedOrigin. */
  expectedOrigins: string[];
} {
  const url = new URL(request.url);
  const rpID =
    (typeof process !== "undefined" && process.env.WEBAUTHN_RP_ID?.trim()) ||
    url.hostname;
  const rpName =
    (typeof process !== "undefined" && process.env.WEBAUTHN_RP_NAME?.trim()) ||
    "Memories";

  const envOrigin =
    typeof process !== "undefined" ? process.env.WEBAUTHN_ORIGIN?.trim() : "";
  let expectedOrigins: string[];
  if (envOrigin) {
    expectedOrigins = envOrigin.split(",").map((s) => s.trim()).filter(Boolean);
    if (expectedOrigins.length === 0) {
      expectedOrigins = buildDefaultOrigins(url);
    }
  } else {
    expectedOrigins = buildDefaultOrigins(url);
  }

  return {
    rpID,
    rpName,
    origin: expectedOrigins[0] ?? url.origin,
    expectedOrigins,
  };
}

function buildDefaultOrigins(url: URL): string[] {
  const set = new Set<string>([url.origin]);
  const host = url.hostname;
  const portPart = url.port ? `:${url.port}` : "";
  const proto = url.protocol;
  if (host === "localhost" || host === "127.0.0.1") {
    set.add(`${proto}//localhost${portPart}`);
    set.add(`${proto}//127.0.0.1${portPart}`);
  }
  return [...set];
}
