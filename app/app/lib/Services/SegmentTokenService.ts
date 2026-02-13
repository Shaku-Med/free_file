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

export function rewriteM3U8(content: string, basePath: string, headers: Headers): string {
  return content
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return line;
      const cleanName = t.split("?")[0];
      const fullPath = basePath ? `${basePath}/${cleanName}` : cleanName;
      const token = createSegmentToken(fullPath, headers);
      const sep = t.includes("?") ? "&" : "?";
      return `${t}${sep}_st=${token}`;
    })
    .join("\n");
}
