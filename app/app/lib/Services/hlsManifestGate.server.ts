import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { HlsPlaybackKind } from "~/lib/Security/Server/hlsBootstrap.server";
import { sessionScope } from "~/lib/Services/SegmentTokenService";

/** Pending one-shot manifest key lifetime (client must fetch manifest within this window). */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** Block replays of a consumed _mk id even if the 10m window has not ended. */
const REPLAY_BLOCK_MS = 4 * 60 * 60 * 1000;
/** HttpOnly continuation cookie: allows variant m3u8 fetches after the first master hit. */
const CONTINUATION_TTL_MS = 2 * 60 * 60 * 1000;

const SWEEP_EVERY_MS = 120_000;

type Pending = {
  manifestPath: string;
  scope: string;
  kind: HlsPlaybackKind;
  exp: number;
};

const pending = new Map<string, Pending>();
const replayUntil = new Map<string, number>();

function getGateSecret(): string {
  return (
    process.env.HLS_MANIFEST_GATE_SECRET ||
    process.env.SEGMENT_TOKEN_SECRET ||
    process.env.VAPID_PRIVATE_KEY ||
    ""
  );
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (v.exp <= now) pending.delete(k);
  }
  for (const [k, until] of replayUntil) {
    if (until <= now) replayUntil.delete(k);
  }
}

if (typeof setInterval !== "undefined") {
  setInterval(sweep, SWEEP_EVERY_MS);
}

export function createPendingManifestKey(
  manifestPath: string,
  headers: Headers,
  kind: HlsPlaybackKind
): string {
  sweep();
  const id = randomBytes(18).toString("base64url");
  pending.set(id, {
    manifestPath,
    scope: sessionScope(headers),
    kind,
    exp: Date.now() + PENDING_TTL_MS,
  });
  return id;
}

export function isManifestKeyReplayBlocked(id: string): boolean {
  sweep();
  return replayUntil.has(id);
}

/**
 * Validates and consumes `_mk` on the first master manifest request; returns Set-Cookie value
 * (full Set-Cookie header body) for the continuation cookie.
 */
/** Longest common / shallowest shared prefix so cookie still covers sibling variant playlists. */
function shallowestCommonPathPrefix(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const ap = a.split("/").filter((p) => p.length > 0);
  const bp = b.split("/").filter((p) => p.length > 0);
  const out: string[] = [];
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
    if (ap[i] !== bp[i]) break;
    out.push(ap[i]);
  }
  return out.join("/");
}

type ParsedMgateCookie = { baseDir: string; exp: number };

function parseVerifiedManifestGateCookie(
  cookieHeader: string | null,
  headers: Headers,
  kind: HlsPlaybackKind
): ParsedMgateCookie | null {
  const raw = readCookie(cookieHeader, "hls_mgate");
  if (!raw) return null;

  const segments = raw.split(".");
  if (segments.length !== 4) return null;
  const [bd64, expStr, kindPart, sig] = segments;
  if (kindPart !== kind) return null;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;

  let baseDir: string;
  try {
    baseDir = Buffer.from(bd64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const scope = sessionScope(headers);
  const payload = `${baseDir}|${exp}|${kind}|${scope}`;
  const expected = createHmac("sha256", getGateSecret()).update(payload).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  return { baseDir, exp };
}

export function tryConsumeManifestKey(
  id: string,
  sanitizedPath: string,
  headers: Headers,
  kind: HlsPlaybackKind
): { setCookieHeader: string } | null {
  sweep();
  if (replayUntil.has(id)) return null;

  const p = pending.get(id);
  if (!p || p.exp <= Date.now()) {
    pending.delete(id);
    return null;
  }
  if (p.manifestPath !== sanitizedPath) return null;
  if (p.scope !== sessionScope(headers)) return null;
  if (p.kind !== kind) return null;

  pending.delete(id);
  replayUntil.set(id, Date.now() + REPLAY_BLOCK_MS);

  const lastSlash = sanitizedPath.lastIndexOf("/");
  const newDir =
    lastSlash === -1 ? sanitizedPath : sanitizedPath.slice(0, lastSlash);

  const prev = parseVerifiedManifestGateCookie(headers.get("Cookie"), headers, kind);
  const baseDir = prev
    ? shallowestCommonPathPrefix(prev.baseDir, newDir)
    : newDir;

  const exp = Date.now() + CONTINUATION_TTL_MS;
  const scope = sessionScope(headers);
  const payload = `${baseDir}|${exp}|${kind}|${scope}`;
  const sig = createHmac("sha256", getGateSecret()).update(payload).digest("base64url");
  const cookieValue = `${Buffer.from(baseDir, "utf8").toString("base64url")}.${exp}.${kind}.${sig}`;

  const maxAge = Math.floor(CONTINUATION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === "production" ? "Secure;" : "";
  const sameSite =
    process.env.NODE_ENV === "production" ? "SameSite=None" : "SameSite=Lax";

  const setCookieHeader = `hls_mgate=${encodeURIComponent(cookieValue)}; Path=/; Max-Age=${maxAge}; HttpOnly; ${secure} ${sameSite}`;

  return { setCookieHeader };
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const t = part.trim();
    if (t.startsWith(`${name}=`)) {
      return decodeURIComponent(t.slice(name.length + 1));
    }
  }
  return null;
}

export function verifyManifestContinuationCookie(
  cookieHeader: string | null,
  sanitizedPath: string,
  headers: Headers,
  kind: HlsPlaybackKind
): boolean {
  const parsed = parseVerifiedManifestGateCookie(cookieHeader, headers, kind);
  if (!parsed) return false;
  const { baseDir } = parsed;
  return (
    sanitizedPath === baseDir || sanitizedPath.startsWith(`${baseDir}/`)
  );
}
