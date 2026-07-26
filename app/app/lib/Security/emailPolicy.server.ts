/**
 * Signup email policy — ALLOWLIST, not blocklist.
 *
 * Chasing disposable domains is unwinnable: there are tens of thousands and new
 * ones appear daily, so a blocklist is always one step behind (that's exactly
 * how minitts.net got through). Inverting it fixes the class of problem:
 * we accept a known set of real mail providers and DENY everything else by
 * default. An unknown domain — including every burner ever registered — fails
 * closed without us having to have heard of it.
 *
 * SERVER ONLY (.server.ts): never ship the policy to the browser.
 *
 * TRADE-OFF (deliberate): custom/company domains are rejected unless added.
 * Use ALLOWED_EMAIL_EXTRA_DOMAINS to permit them without a code deploy.
 */

/**
 * Real, persistent mail providers. Exact domain match only — no subdomain
 * walking, since none of these use subdomains for addresses and exact matching
 * is the strictest reading.
 */
const ALLOWED_DOMAINS: readonly string[] = [
  // Google
  "gmail.com", "googlemail.com",
  // Microsoft
  "outlook.com", "outlook.co.uk", "outlook.fr", "outlook.de", "outlook.es", "outlook.it",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.es", "hotmail.it",
  "live.com", "live.co.uk", "live.fr", "live.de", "live.nl", "msn.com",
  // Yahoo
  "yahoo.com", "yahoo.co.uk", "yahoo.co.jp", "yahoo.fr", "yahoo.de", "yahoo.es",
  "yahoo.it", "yahoo.ca", "yahoo.com.au", "yahoo.com.br", "yahoo.co.in", "ymail.com", "rocketmail.com",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // Privacy-focused (real accounts, not throwaways)
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me",
  "tutanota.com", "tutanota.de", "tuta.io", "tutamail.com",
  "fastmail.com", "fastmail.fm", "hey.com", "duck.com", "simplelogin.io",
  // Other major providers
  "aol.com", "zoho.com", "zohomail.com", "mail.com", "gmx.com", "gmx.de", "gmx.net",
  "gmx.at", "gmx.ch", "web.de", "yandex.com", "yandex.ru",
  // Asia
  "qq.com", "163.com", "126.com", "sina.com", "sina.cn", "foxmail.com", "aliyun.com",
  "naver.com", "daum.net", "hanmail.net", "nate.com",
  "rediffmail.com", "sify.com",
  // Europe
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr", "bbox.fr",
  "t-online.de", "freenet.de", "arcor.de",
  "libero.it", "virgilio.it", "alice.it", "tiscali.it", "tin.it",
  "seznam.cz", "centrum.cz", "wp.pl", "o2.pl", "interia.pl", "onet.pl", "op.pl",
  "mail.ru", "bk.ru", "list.ru", "inbox.ru", "rambler.ru", "ukr.net", "i.ua",
  "abv.bg", "mynet.com", "terra.com.br", "uol.com.br", "bol.com.br", "globo.com",
  "telenet.be", "skynet.be", "ziggo.nl", "kpnmail.nl", "home.nl",
  "telia.com", "online.no", "bluewin.ch", "sapo.pt", "eircom.net",
  // ISPs (North America / Oceania)
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net",
  "cox.net", "charter.net", "earthlink.net", "optonline.net", "roadrunner.com",
  "windstream.net", "frontier.com", "juno.com", "netzero.net",
  "btinternet.com", "sky.com", "virginmedia.com", "talktalk.net", "blueyonder.co.uk",
  "shaw.ca", "rogers.com", "bell.net", "telus.net", "sympatico.ca", "videotron.ca",
  "bigpond.com", "optusnet.com.au", "iinet.net.au", "xtra.co.nz",
  // Our own
  "brozy.org", "memories.brozy.org",
];

/**
 * Institutional suffixes accepted wholesale. You cannot casually register a
 * throwaway under these — they're issued by accredited schools — and blocking
 * every student would be a real loss.
 */
const ALLOWED_SUFFIXES: readonly string[] = [
  ".edu",
  ".ac.uk",
  ".edu.au",
  ".ac.nz",
  ".edu.sg",
  ".ac.jp",
  ".edu.ca",
];

const ALLOWED = new Set<string>(ALLOWED_DOMAINS);

/**
 * Extra domains permitted via env (comma / space / semicolon separated).
 * ADDITIVE ONLY, so a missing or malformed value can never widen the policy
 * beyond what's listed here plus what you explicitly name.
 * e.g. ALLOWED_EMAIL_EXTRA_DOMAINS="mycompany.com, partner.org"
 */
let extraCache: Set<string> | null = null;
function extraDomains(): Set<string> {
  if (extraCache === null) {
    const raw = process.env.ALLOWED_EMAIL_EXTRA_DOMAINS;
    const parsed = (typeof raw === "string" ? raw : "")
      .split(/[\s,;]+/)
      .map((d) => normalizeDomain(d))
      .filter((d) => d.length > 0 && d.length <= 253 && d.includes("."));
    extraCache = new Set(parsed);
  }
  return extraCache;
}

/** Lowercase, strip whitespace and any wrapping dots. Plain string ops (no ReDoS). */
function normalizeDomain(input: string): string {
  if (!input || typeof input !== "string") return "";
  let d = input.trim().toLowerCase().replace(/\s+/g, "");
  while (d.startsWith(".")) d = d.slice(1);
  while (d.endsWith(".")) d = d.slice(0, -1);
  return d;
}

/** True when the domain is an approved provider. Unknown => false (denied). */
export function isAllowedEmailDomain(domain: string): boolean {
  const d = normalizeDomain(domain);
  if (!d || d.length > 253 || !d.includes(".")) return false;
  if (ALLOWED.has(d) || extraDomains().has(d)) return true;
  return ALLOWED_SUFFIXES.some((suffix) => d.endsWith(suffix));
}

/**
 * True when the address may be used to sign up.
 * Splits on the LAST "@" so a quoted local part can't smuggle a fake domain.
 */
export function isAllowedEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) return false;
  return isAllowedEmailDomain(email.slice(at + 1));
}

/** Test seam: re-read the env overrides. */
export function resetEmailPolicyCache(): void {
  extraCache = null;
}
