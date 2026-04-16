import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL = 14400;

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

function sign(message: string): string {
  return createHmac("sha256", getSecret()).update(message).digest("base64url");
}

export function createSegmentToken(segmentPath: string, headers: Headers): string {
  const ip = extractIp(headers);
  const ua = headers.get("user-agent") || "";
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  return `${sign(`${segmentPath}|${ip}|${ua}|${exp}`)}.${exp}`;
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
  const ua = headers.get("user-agent") || "";
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const lim = Math.max(1, Math.min(10 * 60, Math.floor(Number(guestLimitSeconds))));
  return `${sign(`${segmentPath}|${ip}|${ua}|${exp}|guest|${lim}`)}.${exp}`;
}

export function verifySegmentToken(token: string, segmentPath: string, headers: Headers): boolean {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return false;

    const sig = token.substring(0, dot);
    const exp = parseInt(token.substring(dot + 1), 10);
    if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return false;

    const ip = extractIp(headers);
    const ua = headers.get("user-agent") || "";
    const expected = sign(`${segmentPath}|${ip}|${ua}|${exp}`);

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
    const ua = headers.get("user-agent") || "";
    const lim = Math.max(1, Math.min(10 * 60, Math.floor(Number(guestLimitSeconds))));
    const expected = sign(`${segmentPath}|${ip}|${ua}|${exp}|guest|${lim}`);

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
};

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

  return content
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return line;
      const cleanName = t.split("?")[0];
      const fullPath = basePath ? `${basePath}/${cleanName}` : cleanName;
      const token = useGuestToken
        ? createGuestSegmentToken(fullPath, headers, gl!)
        : createSegmentToken(fullPath, headers);
      const sep = t.includes("?") ? "&" : "?";
      return `${t}${sep}_st=${token}`;
    })
    .join("\n");
}
