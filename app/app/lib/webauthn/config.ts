/**
 * WebAuthn RP config. Prefer WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN in production
 * so passkeys work behind proxies and on the real hostname.
 *
 * WEBAUTHN_ORIGIN may be comma-separated. If you set only http:// or only https://,
 * the other scheme for the same host is added automatically so TLS termination
 * (browser = https, Node sees http) still verifies.
 *
 * Behind nginx/Caddy, X-Forwarded-Proto / X-Forwarded-Host (or Forwarded) are used
 * so the allowed origin matches what the browser sends.
 */

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  return value.split(",")[0]?.trim() ?? null;
}

/** Origin as the browser sees it (after TLS termination). */
function getPublicOriginFromRequest(request: Request): string {
  const forwardedRaw = firstHeaderValue(request.headers.get("forwarded"));
  if (forwardedRaw) {
    const firstHop = forwardedRaw.split(",")[0]?.trim() ?? forwardedRaw;
    const segments = firstHop.split(";").map((s) => s.trim());
    let proto: string | null = null;
    let host: string | null = null;
    for (const p of segments) {
      const eq = p.indexOf("=");
      if (eq === -1) continue;
      const k = p.slice(0, eq).trim().toLowerCase();
      const v = p.slice(eq + 1).trim().replace(/^"|"$/g, "");
      if (k === "proto") proto = v;
      if (k === "host") host = v;
    }
    if (proto && host) {
      return `${proto}://${host}`;
    }
  }

  const xfProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const xfHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (xfProto && xfHost) {
    return `${xfProto}://${xfHost}`;
  }

  return new URL(request.url).origin;
}

/** Hostname for rpID when not using WEBAUTHN_RP_ID (public host behind proxy). */
function getPublicHostname(request: Request): string {
  const xfHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (xfHost) {
    return xfHost.split(":")[0]?.trim() || new URL(request.url).hostname;
  }
  const fromForwarded = firstHeaderValue(request.headers.get("forwarded"));
  if (fromForwarded) {
    for (const p of fromForwarded.split(";")) {
      const eq = p.indexOf("=");
      if (eq === -1) continue;
      if (p.slice(0, eq).trim().toLowerCase() === "host") {
        const v = p.slice(eq + 1).trim().replace(/^"|"$/g, "");
        return v.split(":")[0] || new URL(request.url).hostname;
      }
    }
  }
  return new URL(request.url).hostname;
}

/** Add http/https peer for the same host:port (fixes TLS termination + env typos). */
function expandHttpHttpsPeers(origins: string[]): string[] {
  const set = new Set(origins);
  for (const o of origins) {
    try {
      const u = new URL(o);
      const hostPort = u.host;
      if (u.protocol === "https:") {
        set.add(`http://${hostPort}`);
      } else if (u.protocol === "http:") {
        set.add(`https://${hostPort}`);
      }
    } catch {
      /* skip invalid */
    }
  }
  return [...set];
}

function buildDefaultOrigins(publicUrl: URL): string[] {
  const set = new Set<string>([publicUrl.origin]);
  const host = publicUrl.hostname;
  const portPart = publicUrl.port ? `:${publicUrl.port}` : "";
  const proto = publicUrl.protocol;

  if (host === "localhost" || host === "127.0.0.1") {
    set.add(`${proto}//localhost${portPart}`);
    set.add(`${proto}//127.0.0.1${portPart}`);
    return [...set];
  }

  return expandHttpHttpsPeers([...set]);
}

export function getWebAuthnConfig(request: Request): {
  rpID: string;
  rpName: string;
  /** Primary origin (e.g. returned to the client); use expectedOrigins for verification. */
  origin: string;
  /** Pass to verifyRegistrationResponse / verifyAuthenticationResponse as expectedOrigin. */
  expectedOrigins: string[];
} {
  const url = new URL(request.url);
  let publicUrl: URL;
  try {
    publicUrl = new URL(getPublicOriginFromRequest(request));
  } catch {
    publicUrl = url;
  }

  const rpID =
    (typeof process !== "undefined" && process.env.WEBAUTHN_RP_ID?.trim()) ||
    getPublicHostname(request);

  const rpName =
    (typeof process !== "undefined" && process.env.WEBAUTHN_RP_NAME?.trim()) ||
    "Memories";

  const envOrigin =
    typeof process !== "undefined" ? process.env.WEBAUTHN_ORIGIN?.trim() : "";

  let expectedOrigins: string[];
  if (envOrigin) {
    const listed = envOrigin.split(",").map((s) => s.trim()).filter(Boolean);
    expectedOrigins = listed.length > 0 ? expandHttpHttpsPeers(listed) : buildDefaultOrigins(publicUrl);
  } else {
    expectedOrigins = buildDefaultOrigins(publicUrl);
  }

  const preferredHttps =
    expectedOrigins.find((o) => o.startsWith("https://")) ?? expectedOrigins[0] ?? publicUrl.origin;

  return {
    rpID,
    rpName,
    origin: preferredHttps,
    expectedOrigins,
  };
}
