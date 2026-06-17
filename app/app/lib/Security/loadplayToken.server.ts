/**
 * loadplayToken.server.ts
 *
 * Mints HMAC-SHA256 playback tokens that the Go LoadPlay service can
 * verify. The wire format must match exactly  see
 * `GoUpload/loadplay/internal/token/verify.go`.
 *
 * Token: `base64url(JSON_payload).base64url(HMAC_SHA256(secret, payload_b64url))`
 *
 * Both sides share `SEGMENT_TOKEN_SECRET` in env. Never expose to client.
 */

import { createHmac, createHash, randomBytes } from "crypto";
import { computeGuestPreviewSeconds } from "~/lib/guestPreviewLimit";

const SECRET_ENV = "SEGMENT_TOKEN_SECRET";
const GUEST_PLAYBACK_TTL_MS = 5 * 60_000;
// Short signed-in TTL keeps the replay window tight. The client
// re-mints automatically via usePlaybackUrl on file change, and
// usePlaybackUrl can be extended to refresh on token-near-expiry.
const SIGNED_IN_PLAYBACK_TTL_MS = 15 * 60_000;

/** LoadPlay CDN origin  override with `LOADPLAY_BASE_URL` in env. */
export const LOADPLAY_DEV_ORIGIN = "http://localhost:3006";
export const LOADPLAY_PROD_ORIGIN = "https://cdn.memories.brozy.org";

/** Strict private-IPv4 LITERAL check — never matches a DNS name, so a forged
 * Host like "192.168.1.9.evil.com" can't slip through (no host-header injection). */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 127
  );
}

/**
 * DEV ONLY: when the app is opened over the LAN (e.g. a phone at
 * 192.168.1.169:3000), `localhost` would point the phone at ITSELF. Rewrite the
 * loadplay origin to that same private IP on loadplay's dev port so the phone
 * reaches the dev machine.
 *
 * Hardened: accepts only a private-IPv4 *literal* Host, and always uses OUR
 * configured dev port (never a port from the client), so even a spoofed Host
 * header can at most point playback at another private IP on our dev port —
 * never an external/arbitrary server. Returns null (→ localhost) otherwise.
 */
function devLanLoadplayOrigin(request: Request | undefined): string | null {
  if (!request) return null;
  try {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const hostname = host.split(":")[0].trim().toLowerCase();
    if (!isPrivateIPv4(hostname) || hostname === "127.0.0.1") return null;
    const devPort = new URL(LOADPLAY_DEV_ORIGIN).port || "3006";
    return `http://${hostname}:${devPort}`;
  } catch {
    return null;
  }
}

/** Public LoadPlay origin for the current environment (request-aware in dev). */
export function getLoadplayBaseUrl(request?: Request): string {
  const override = process.env.LOADPLAY_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  const isProd =
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production";
  if (isProd) return LOADPLAY_PROD_ORIGIN;
  // Dev: prefer the LAN IP the request arrived on (so phones reach loadplay),
  // else fall back to localhost.
  return devLanLoadplayOrigin(request) ?? LOADPLAY_DEV_ORIGIN;
}

function getSecret(): Buffer {
  const raw = process.env[SECRET_ENV];
  if (!raw) return Buffer.alloc(0);
  return Buffer.from(raw, "utf8");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export interface MintInput {
  fileId: string;
  userId?: string;
  path: string;
  ttlMs?: number;
  ipHash?: string;
  uaHash?: string;
  nonce?: string;
  guestLimitSeconds?: number;
}

export interface MintResult {
  token: string;
  exp: number;
}

export function mintLoadplayToken(input: MintInput): MintResult | null {
  const secret = getSecret();
  if (secret.length === 0) return null;

  const ttl = Math.max(10_000, input.ttlMs ?? 5 * 60_000);
  const exp = Date.now() + ttl;

  const payload: Record<string, unknown> = {
    f: input.fileId,
    p: input.path,
    e: exp,
  };
  if (input.userId) payload.u = input.userId;
  if (
    !input.userId &&
    input.guestLimitSeconds != null &&
    Number.isFinite(input.guestLimitSeconds) &&
    input.guestLimitSeconds > 0
  ) {
    payload.g = Math.floor(input.guestLimitSeconds);
  }
  if (input.ipHash) payload.i = input.ipHash;
  if (input.uaHash) payload.a = input.uaHash;
  // Always emit a nonce. LoadPlay binds the first fingerprint to use it
  // and rejects copies pasted into a different browser / network 
  // even if the HMAC + expiry still check out.
  payload.n = input.nonce ?? b64url(randomBytes(12));

  const bodyJson = JSON.stringify(payload);
  const bodyB64 = b64url(Buffer.from(bodyJson, "utf8"));
  const sig = createHmac("sha256", secret).update(bodyB64).digest();
  const sigB64 = b64url(sig);

  return { token: `${bodyB64}.${sigB64}`, exp };
}

export function resolveHlsManifestPath(
  endpoint: string,
  fileType?: string | null,
): string | null {
  if (!endpoint) return null;
  const isHLS =
    fileType === "application/vnd.apple.mpegurl" ||
    endpoint.includes(".m3u8") ||
    endpoint.includes(".m2u8");
  if (!isHLS) return null;
  const clean = endpoint.replace(/^\//, "");
  if (clean.includes(".m3u8") || clean.includes(".m2u8")) return clean;
  return `${clean.replace(/\/?$/, "")}/master.m3u8`;
}

function loadplayBaseUrl(request?: Request): string {
  return getLoadplayBaseUrl(request);
}

/** Mint a signed LoadPlay master URL. All HLS playback goes through the CDN. */
export function buildPlaybackUrlForFile(
  file: {
    unique_id: string;
    endpoint?: string | null;
    file_type?: string | null;
    duration?: number | null;
  },
  userId?: string | null,
  bind?: { ipHash?: string; uaHash?: string },
  /** Dev: lets the base URL follow the LAN host the request came in on. */
  request?: Request,
): string | null {
  const baseUrl = loadplayBaseUrl(request);
  if (!file.unique_id) return null;
  const path = resolveHlsManifestPath(file.endpoint ?? "", file.file_type);
  if (!path) return null;

  const isGuest = !userId;
  const guestLimitSeconds = isGuest
    ? computeGuestPreviewSeconds(Number(file.duration) || 0)
    : undefined;

  const built = buildLoadplayUrl({
    baseUrl,
    fileId: file.unique_id,
    path,
    userId: userId ?? undefined,
    guestLimitSeconds,
    ipHash: bind?.ipHash,
    uaHash: bind?.uaHash,
    ttlMs: isGuest ? GUEST_PLAYBACK_TTL_MS : SIGNED_IN_PLAYBACK_TTL_MS,
  });
  return built?.url ?? null;
}

export function buildLoadplayUrl(opts: {
  baseUrl: string;
  fileId: string;
  path: string;
  userId?: string;
  ttlMs?: number;
  guestLimitSeconds?: number;
  ipHash?: string;
  uaHash?: string;
}): { url: string; exp: number } | null {
  const minted = mintLoadplayToken({
    fileId: opts.fileId,
    userId: opts.userId,
    path: opts.path,
    ttlMs: opts.ttlMs,
    guestLimitSeconds: opts.guestLimitSeconds,
    ipHash: opts.ipHash,
    uaHash: opts.uaHash,
  });
  if (!minted) return null;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const safePath = opts.path
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return {
    url: `${base}/v/${encodeURIComponent(opts.fileId)}/${safePath}?t=${minted.token}`,
    exp: minted.exp,
  };
}

export function hashFingerprint(value: string): string {
  if (!value) return "";
  return b64url(createHash("sha256").update(value).digest()).slice(0, 16);
}
