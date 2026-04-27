import { createHmac, timingSafeEqual } from "crypto";
import { getCookie } from "~/lib/Security/Token";
import { sanitizeFilePath } from "~/lib/Security/inputValidation";

/**
 * Guest preview: keep short so leaked segment URLs die quickly.
 * Signed-in: `_st` is minted for every segment URL when the manifest is rewritten; static VoD
 * playlists often never reload, so TTL must cover your longest typical watch. Bound to IP + sessionScope.
 */
const GUEST_SEGMENT_TOKEN_TTL_SEC = 300;
/** Default 1h (was 5m). For 5h+ files without manifest refresh, raise (e.g. `8 * 3600`). */
const SIGNED_IN_SEGMENT_TOKEN_TTL_SEC = 3600;

function getSecret(): string {
  return process.env.SEGMENT_TOKEN_SECRET || process.env.VAPID_PRIVATE_KEY || "";
}

function extractIp(headers: Headers): string {
  return (
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-client-ip") ||
    headers.get("true-client-ip") ||
    headers.get("fly-client-ip") ||
    headers.get("do-connecting-ip") ||
    "0.0.0.0"
  );
}

/**
 * Stable per-browser identifier derived from the auth cookie. We HMAC the
 * cookie so the segment URL never echoes it back. A stolen segment URL is
 * useless in any other session because the binding here won't match.
 * `c_user` for signed-in, `token` for guests; "anon" only when neither
 * cookie is present (rare — the route already requires one path or another).
 */
/** Exported for HLS manifest gate + session rate limits (same binding as segment tokens). */
export function sessionScope(headers: Headers): string {
  const cu = getCookie("c_user", headers);
  if (cu) {
    return "u:" + createHmac("sha256", getSecret()).update(cu).digest("base64url").slice(0, 16);
  }
  const tok = getCookie("token", headers);
  if (tok) {
    return "g:" + createHmac("sha256", getSecret()).update(tok).digest("base64url").slice(0, 16);
  }
  return "anon";
}

function sign(message: string): string {
  return createHmac("sha256", getSecret()).update(message).digest("base64url");
}

/**
 * Bucket key for rate-limiting: combines the session-cookie scope with
 * client IP so household NATs don't penalize each other and a single
 * compromised session can't be parallelized across hosts.
 */
export function sessionRateKey(headers: Headers): string {
  return `${sessionScope(headers)}|${extractIp(headers)}`;
}

export function createSegmentToken(segmentPath: string, headers: Headers): string {
  const ip = extractIp(headers);
  const ss = sessionScope(headers);
  const exp = Math.floor(Date.now() / 1000) + SIGNED_IN_SEGMENT_TOKEN_TTL_SEC;
  return `${sign(`${segmentPath}|${ip}|${ss}|${exp}`)}.${exp}`;
}

/**
 * Signed-out preview only: binds segment URL to the server-chosen preview cap so
 * tokens from a full (signed-in) playlist cannot be reused while logged out.
 * The limit is never taken from the client — callers pass the same value used for HLS truncation.
 */
export function createGuestSegmentToken(
  segmentPath: string,
  headers: Headers,
  guestLimitSeconds: number
): string {
  const ip = extractIp(headers);
  const ss = sessionScope(headers);
  const exp = Math.floor(Date.now() / 1000) + GUEST_SEGMENT_TOKEN_TTL_SEC;
  const lim = Math.max(1, Math.min(10 * 60, Math.floor(Number(guestLimitSeconds))));
  return `${sign(`${segmentPath}|${ip}|${ss}|${exp}|guest|${lim}`)}.${exp}`;
}

export function verifySegmentToken(token: string, segmentPath: string, headers: Headers): boolean {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return false;

    const sig = token.substring(0, dot);
    const exp = parseInt(token.substring(dot + 1), 10);
    if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return false;

    const ip = extractIp(headers);
    const ss = sessionScope(headers);
    const expected = sign(`${segmentPath}|${ip}|${ss}|${exp}`);

    if (sig.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyGuestSegmentToken(
  token: string,
  segmentPath: string,
  headers: Headers,
  guestLimitSeconds: number
): boolean {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return false;

    const sig = token.substring(0, dot);
    const exp = parseInt(token.substring(dot + 1), 10);
    if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return false;

    const ip = extractIp(headers);
    const ss = sessionScope(headers);
    const lim = Math.max(1, Math.min(10 * 60, Math.floor(Number(guestLimitSeconds))));
    const expected = sign(`${segmentPath}|${ip}|${ss}|${exp}|guest|${lim}`);

    if (sig.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export type RewriteM3U8Options = {
  guestMode?: boolean;
  /** Server-computed preview window (seconds); ignored unless guestMode */
  guestLimitSeconds?: number;
  /**
   * When set, each nested `.m3u8` reference also gets a one-shot `_mk` (server should use
   * `createPendingManifestKey`). Master playlists with `playlist.m3u8` / `URI="…m3u8"` then work
   * even if continuation-cookie scope would otherwise narrow per subfolder.
   */
  mintChildManifestKey?: (sanitizedFullPath: string) => string | undefined;
};

function isM3u8ResourceRef(ref: string): boolean {
  const clean = ref.split("?")[0].split("#")[0].toLowerCase();
  return clean.endsWith(".m3u8") || clean.endsWith(".m2u8");
}

/** Resolve HLS relative reference against the manifest directory (POSIX-style, no `..` left). */
function resolveUnderBasePath(basePath: string, ref: string): string {
  const q = ref.split("?")[0].split("#")[0];
  if (!q || /^https?:\/\//i.test(q)) return q;
  const baseParts = basePath.split("/").filter((p) => p.length > 0);
  const relParts = q.split("/").filter((p) => p !== "." && p.length > 0);
  const stack = ref.startsWith("/") ? [] : [...baseParts];
  for (const p of relParts) {
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return stack.join("/");
}

function appendStAndOptionalMk(
  rawRef: string,
  fullPathForSt: string,
  headers: Headers,
  useGuestToken: boolean,
  gl: number | null,
  mintChildManifestKey: ((p: string) => string | undefined) | undefined
): string {
  const token = useGuestToken && gl != null && gl > 0
    ? createGuestSegmentToken(fullPathForSt, headers, gl)
    : createSegmentToken(fullPathForSt, headers);
  let out = `${rawRef}${rawRef.includes("?") ? "&" : "?"}_st=${token}`;
  if (mintChildManifestKey && isM3u8ResourceRef(rawRef)) {
    const sanitized = sanitizeFilePath(fullPathForSt);
    if (sanitized && isM3u8ResourceRef(sanitized)) {
      const mk = mintChildManifestKey(sanitized);
      if (mk) out += `&_mk=${encodeURIComponent(mk)}`;
    }
  }
  return out;
}

/** Rewrite `URI="…"` / `URI='…'` on #EXT-X-* lines (alternate renditions, audio, etc.). */
function rewriteUriAttributesInExtLine(
  line: string,
  basePath: string,
  headers: Headers,
  useGuestToken: boolean,
  gl: number | null,
  mintChildManifestKey?: (p: string) => string | undefined
): string {
  return line.replace(/\bURI\s*=\s*("[^"]*"|'[^']*')/gi, (full, quoted: string) => {
    const q = quoted[0];
    const inner = quoted.slice(1, -1);
    if (!inner || /^https?:\/\//i.test(inner)) return full;
    if (!isM3u8ResourceRef(inner)) return full;
    const resolved = resolveUnderBasePath(basePath, inner);
    const sanitized = sanitizeFilePath(resolved);
    if (!sanitized) return full;
    const newInner = appendStAndOptionalMk(
      inner,
      sanitized,
      headers,
      useGuestToken,
      gl,
      mintChildManifestKey
    );
    return `URI=${q}${newInner}${q}`;
  });
}

export function rewriteM3U8(
  content: string,
  basePath: string,
  headers: Headers,
  options?: RewriteM3U8Options
): string {
  const guestMode = options?.guestMode === true;
  const gl =
    options?.guestLimitSeconds != null && Number.isFinite(options.guestLimitSeconds)
      ? Math.floor(options.guestLimitSeconds)
      : null;
  const useGuestToken = guestMode && gl != null && gl > 0;
  const mintChildManifestKey = options?.mintChildManifestKey;

  return content
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        if (t.includes("URI=")) {
          return rewriteUriAttributesInExtLine(
            line,
            basePath,
            headers,
            useGuestToken,
            gl,
            mintChildManifestKey
          );
        }
        return line;
      }
      const cleanName = t.split("?")[0];
      const resolved = resolveUnderBasePath(basePath, cleanName);
      const sanitized = sanitizeFilePath(resolved);
      const fullPath = sanitized ?? (basePath ? `${basePath}/${cleanName}` : cleanName);
      return appendStAndOptionalMk(
        t,
        fullPath,
        headers,
        useGuestToken,
        gl,
        mintChildManifestKey
      );
    })
    .join("\n");
}
