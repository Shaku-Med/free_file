import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF protection for server-side fetches whose URL is influenced by user
 * input. Blocks non-http(s) schemes and any request that resolves to a
 * private / loopback / link-local / reserved address (including the cloud
 * metadata endpoint 169.254.169.254). Redirects are followed manually so each
 * hop is re-validated (defeats DNS-rebinding-style redirect bypasses).
 */

const MAX_REDIRECTS = 4;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Parse an IPv4 dotted string into its 32-bit integer, or null. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable -> treat as unsafe
  const inRange = (base: string, maskBits: number) => {
    const baseInt = ipv4ToInt(base)!;
    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    return (n & mask) === (baseInt & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. cloud metadata)
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.0.2.0', 24) || // TEST-NET
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('198.51.100.0', 24) || // TEST-NET-2
    inRange('203.0.113.0', 24) || // TEST-NET-3
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved (incl. 255.255.255.255 broadcast)
  );
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0]; // strip zone id
  if (lower === '::1' || lower === '::') return true;
  // IPv4-mapped / -compatible: ::ffff:1.2.3.4 -> validate embedded IPv4
  const mapped = lower.match(/(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  if (lower.startsWith('ff')) return true; // multicast
  return false;
}

function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP literal -> unsafe
}

/**
 * Validate a URL is http(s) and that every DNS answer for its host is a
 * public address. Throws on any violation.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  const host = parsed.hostname;
  // Reject obvious literal targets before any DNS work.
  if (host.length === 0) throw new Error('Invalid host');
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error('Blocked address');
    return parsed;
  }
  // Resolve all A/AAAA records and ensure none point to a private range.
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('DNS resolution failed');
  }
  if (!records.length) throw new Error('DNS resolution failed');
  for (const rec of records) {
    if (isBlockedAddress(rec.address)) throw new Error('Blocked address');
  }
  return parsed;
}

/**
 * Drop-in replacement for `fetch` that enforces {@link assertPublicUrl} on the
 * initial URL and on every redirect hop. Always uses `redirect: 'manual'`.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let current = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, { ...init, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      if (i === maxRedirects) throw new Error('Too many redirects');
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}
