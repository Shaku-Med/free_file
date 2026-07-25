/**
 * Trusted client-IP resolution.
 *
 * WHY THIS EXISTS: `X-Forwarded-For` is a client-supplied header. Reading the
 * LEFTMOST entry (`xff.split(",")[0]`) hands the caller full control of their
 * own rate-limit bucket — send a random XFF per request and every IP-keyed
 * limit (login, signup, reset, verify, resend) becomes a no-op.
 *
 * nginx is configured with `$proxy_add_x_forwarded_for`, which APPENDS the real
 * peer address to whatever the client sent:
 *
 *     client sends:  X-Forwarded-For: 9.9.9.9            (spoofed)
 *     nginx passes:  X-Forwarded-For: 9.9.9.9, 203.0.113.7   (real peer last)
 *
 * So the only trustworthy entries are the ones our own proxies appended — the
 * RIGHTMOST ones. We step back `TRUSTED_PROXY_HOPS` entries from the end
 * (default 1 = a single nginx in front). Everything to the left is attacker
 * text and is ignored.
 *
 * Set TRUSTED_PROXY_HOPS=2 if another trusted proxy (e.g. Cloudflare) is added
 * in front of nginx. Too LOW is safe (you read a proxy's own IP and over-group
 * requests); too HIGH is not (you start trusting attacker-supplied entries), so
 * the value is clamped and defaults conservatively.
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function trustedHops(): number {
  // Guarded: this module is intentionally NOT `.server.ts` (it holds no secrets
  // and is pulled in by the rate limiter, which the client bundle references),
  // so `process` may not exist in a browser context.
  const raw =
    typeof process !== 'undefined' ? process.env?.TRUSTED_PROXY_HOPS : undefined;
  const n = raw ? Number.parseInt(raw, 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  // Ceiling: more than a handful of trusted proxies is a misconfiguration, and
  // every extra hop walks further left into attacker-controlled text.
  return Math.min(n, 3);
}

/** Strip an optional port and IPv6 brackets: "[::1]:443" / "1.2.3.4:56" → host. */
function stripPort(value: string): string {
  let v = value.trim();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    if (end !== -1) return v.slice(1, end);
    return "";
  }
  // Only strip a port for IPv4/hostname form (bare IPv6 has many colons).
  const colons = (v.match(/:/g) || []).length;
  if (colons === 1) v = v.slice(0, v.indexOf(":"));
  return v;
}

function isIpv4(value: string): boolean {
  const m = IPV4_RE.exec(value);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return false;
  }
  return true;
}

function isIpv6(value: string): boolean {
  // Conservative shape check — hex groups and colons only, at least one colon.
  // Deliberately simple: this gates a rate-limit key, not a security decision
  // on the address itself, and a strict RFC parser here would be ReDoS surface.
  if (!value.includes(":")) return false;
  if (value.length > 45) return false;
  return /^[0-9a-fA-F:.]+$/.test(value);
}

function isIp(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

/**
 * The real client IP, or "" when it can't be established.
 * Callers should treat "" as a single shared bucket (fail closed / grouped),
 * never as "skip the limit".
 */
export function trustedClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => stripPort(p))
      .filter((p) => p.length > 0 && isIp(p));

    if (parts.length > 0) {
      // Walk back from the right by the number of proxies we control.
      const idx = parts.length - trustedHops();
      // If the chain is SHORTER than the configured hop count, the config is
      // wrong (or a request skipped a proxy). Fall back to the RIGHTMOST entry
      // — always the one our closest proxy appended — instead of the leftmost,
      // which is pure client input. Misconfiguration must degrade to the safest
      // value, never to the attacker-controlled one.
      return parts[idx >= 0 ? idx : parts.length - 1].toLowerCase();
    }
  }

  // No usable XFF: only reachable when nothing proxied the request (local dev
  // or a direct hit). nginx overwrites X-Real-IP with $remote_addr, so it is
  // trustworthy in production and merely spoofable-but-irrelevant in dev.
  const real = request.headers.get("x-real-ip");
  if (real) {
    const host = stripPort(real);
    if (isIp(host)) return host.toLowerCase();
  }

  return "";
}

/**
 * Rate-limit bucket key for an IP.
 * IPv6 is grouped to its /64 because a single customer is routinely handed an
 * entire /64 — keying on the full address would let one attacker cycle through
 * billions of "distinct" IPs and never trip a limit. IPv4 is keyed exactly.
 */
export function clientIpBucket(request: Request): string {
  const ip = trustedClientIp(request);
  if (!ip) return "unknown";
  if (isIpv4(ip)) return ip;

  // IPv6 → first four hextets (/64).
  const expanded = ip.split(":");
  const groups: string[] = [];
  for (const g of expanded) {
    if (groups.length >= 4) break;
    if (g === "") continue; // "::" compression — good enough for bucketing
    groups.push(g);
  }
  return groups.length > 0 ? `${groups.join(":")}::/64` : "unknown";
}
