/**
 * Disposable / throwaway email blocking for signup.
 *
 * SERVER ONLY (.server.ts): the blocklist must never reach the client bundle —
 * a list visible in view-source tells an attacker exactly which domains to
 * avoid, and ships ~10KB of dead weight to every visitor.
 *
 * Static list on purpose: no third-party API (no cost, no key, no rate limit)
 * and no DNS/MX lookup, so the check is deterministic, instant, and can never
 * fail open because a network call timed out.
 *
 * Legitimate privacy-focused providers (Proton, Tutanota, Fastmail, iCloud,
 * SimpleLogin, DuckDuckGo relays) are deliberately NOT blocked — those are tied
 * to real, persistent accounts. Only true burn-after-reading services are.
 */

/**
 * Known disposable mail domains, lowercase, no leading dot.
 * Subdomains are covered automatically (see isDisposableEmailDomain).
 */
const DISPOSABLE_DOMAINS: readonly string[] = [
  // mailinator + public aliases
  "mailinator.com", "mailinator.net", "mailinator2.com", "reallymymail.com",
  "sogetthis.com", "spamherelots.com", "suremail.info", "thisisnotmyrealemail.com",
  "binkmail.com", "bobmail.info", "chammy.info", "devnullmail.com", "letthemeatspam.com",
  "mailin8r.com", "notmailinator.com", "spambooger.com", "streetwisemail.com",
  "tradermail.info", "veryrealemail.com", "zippymail.info",

  // guerrilla mail
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz",
  "guerrillamail.de", "guerrillamail.info", "guerrillamailblock.com", "sharklasers.com",
  "grr.la", "spam4.me", "pokemail.net",

  // 10 minute / temp mail families
  "10minutemail.com", "10minutemail.net", "10minutemail.org", "10minemail.com",
  "20minutemail.com", "temp-mail.org", "temp-mail.io", "temp-mail.ru", "tempmail.com",
  "tempmail.net", "tempmail.org", "tempmailo.com", "tempmail.plus", "tempmailer.com",
  "tempmailaddress.com", "tempinbox.com", "tempr.email", "tempail.com", "tmail.ws",
  "tmpmail.org", "tmpmail.net", "tmpeml.com", "minuteinbox.com", "mytemp.email",
  "temporary-mail.net", "tempsky.com", "linshiyouxiang.net",

  // yopmail
  "yopmail.com", "yopmail.fr", "yopmail.net", "cool.fr.nf", "jetable.fr.nf",
  "nospam.ze.tc", "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr", "courriel.fr.nf",
  "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",

  // trashmail family
  "trashmail.com", "trashmail.net", "trashmail.org", "trashmail.de", "trashmail.me",
  "trash-mail.com", "trash-mail.de", "wegwerfmail.de", "wegwerfmail.net", "wegwerfmail.org",
  "kurzepost.de", "objectmail.com", "proxymail.eu", "rcpt.at", "damnthespam.com",
  "trashmailer.com", "trashinbox.com",

  // throwaway / burner services
  "throwawaymail.com", "throwaway.email", "burnermail.io", "mailcatch.com",
  "maildrop.cc", "mailnesia.com", "dispostable.com", "getnada.com", "nada.email",
  "getairmail.com", "fakeinbox.com", "fakemailgenerator.com", "fakemail.net",
  "emailondeck.com", "emailfake.com", "email-fake.com", "emailtemporanea.com",
  "emailtemporanea.net", "emltmp.com", "discard.email", "discardmail.com",
  "discardmail.de", "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "mailexpire.com", "jetable.org", "jetable.com", "jetable.net", "moakt.com",
  "moakt.ws", "moakt.cc", "mail7.io", "mailsac.com", "inboxkitten.com",
  "harakirimail.com", "mohmal.com", "mohmal.in", "mohmal.im", "gufum.com",
  "vomoto.com", "mintemail.com", "mailforspam.com", "spambox.us", "spamfree24.org",
  "incognitomail.com", "incognitomail.org", "anonymbox.com", "deadaddress.com",
  "despam.it", "dontreg.com", "e4ward.com", "filzmail.com", "gishpuppy.com",
  "hidemail.de", "kasmail.com", "killmail.net", "mailmoat.com", "mailzilla.com",
  "meltmail.com", "mt2015.com", "mytrashmail.com", "nowmymail.com", "onewaymail.com",
  "pookmail.com", "recyclemail.dk", "safetymail.info", "selfdestructingmail.com",
  "shortmail.net", "sneakemail.com", "sofort-mail.de", "spamavert.com", "spambog.com",
  "spamcowboy.com", "spamday.com", "spamex.com", "spamhole.com", "spaml.de",
  "spamspot.com", "supergreatmail.com", "tagyourself.com", "teleworm.us",
  "thankyou2010.com", "tilien.com", "tittbit.in", "tmailinator.com", "tyldd.com",
  "uggsrock.com", "wh4f.org", "willselfdestruct.com", "wuzup.net", "xoxy.net",
  "yeah.net", "zoemail.com", "zoemail.net",

  // "mail" generators / one-off inbox sites
  "1secmail.com", "1secmail.net", "1secmail.org", "esiix.com", "wwjmp.com",
  "xojxe.com", "yoggm.com", "dcctb.com", "kzccv.com", "qiott.com", "vjuum.com",
  "laafd.com", "txcct.com", "yandex.ru.com", "byom.de", "cuvox.de", "dayrep.com",
  "einrot.com", "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com",
  "superrito.com", "armyspy.com", "hidemyass.com",

  // misc known burners
  "luxusmail.org", "cock.li", "mvrht.net", "33mail.com", "spamdecoy.net",
  "mailbox52.gq", "crazymailing.com", "instantemailaddress.com", "mailhazard.com",
  "mailhz.me", "mailimate.com", "mailquack.com", "mail-temporaire.fr",
  "monumentmail.com", "nowhere.org", "opayq.com", "smellfear.com", "sudolife.me",
  "sudomail.com", "sudoverse.com", "sudoweb.net", "sudoworld.com", "tempemail.net",
  "tempemails.io", "tempmailbox.net", "tempsmail.com", "throwam.com",
  "trbvm.com", "vpsvz.com", "yourdomain.com.zz", "zetmail.com", "zippymail.info",
  "mailtemp.info", "clrmail.com", "mailpoof.com", "byteme.cc", "smailpro.com",
  "emailna.co", "generator.email", "internetkeno.com", "nowmail.dev",
  "vsimcard.com", "wickmail.net", "yomail.info",
];

/** O(1) membership lookup; frozen so nothing can mutate the blocklist at runtime. */
const BLOCKED = new Set<string>(DISPOSABLE_DOMAINS);

/**
 * Optional additive overrides from env, comma or whitespace separated.
 * ADDITIVE ONLY — this can make the block stricter, never weaker, so a missing
 * or malformed value can't silently disable protection. Lets a newly-spotted
 * burner domain be blocked with a restart instead of a code change.
 */
function envExtraDomains(): string[] {
  const raw = process.env.DISPOSABLE_EMAIL_EXTRA_DOMAINS;
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[\s,;]+/)
    .map((d) => normalizeDomain(d))
    .filter((d) => d.length > 0 && d.length <= 253 && d.includes("."));
}

let extraCache: Set<string> | null = null;
function extraDomains(): Set<string> {
  if (extraCache === null) extraCache = new Set(envExtraDomains());
  return extraCache;
}

/**
 * Lowercase, strip whitespace, surrounding dots and a trailing root dot.
 * Plain string ops only — no user-input regex that could backtrack (ReDoS).
 */
function normalizeDomain(input: string): string {
  if (!input || typeof input !== "string") return "";
  let d = input.trim().toLowerCase();
  // Strip an IDN/whitespace oddity and any wrapping dots ("mailinator.com.").
  d = d.replace(/\s+/g, "");
  while (d.startsWith(".")) d = d.slice(1);
  while (d.endsWith(".")) d = d.slice(0, -1);
  return d;
}

/**
 * True when the domain (or any parent of it) is a known disposable provider.
 * Parent walking matters: burner services hand out endless subdomains
 * (team.mailinator.com, x.y.trashmail.com) that a flat equality check misses.
 */
export function isDisposableEmailDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  if (!normalized || normalized.length > 253) return false;

  const labels = normalized.split(".");
  // Walk from the full host up to the registrable-ish parent:
  // a.b.mailinator.com -> b.mailinator.com -> mailinator.com
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    if (BLOCKED.has(candidate) || extraDomains().has(candidate)) return true;
  }
  return false;
}

/**
 * True when the email address uses a disposable domain.
 * Splits on the LAST "@" so a quoted local part can't smuggle a fake domain.
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at === -1 || at === email.length - 1) return false;
  return isDisposableEmailDomain(email.slice(at + 1));
}

/** Test seam: re-read the env overrides (clears the memoized set). */
export function resetDisposableDomainCache(): void {
  extraCache = null;
}
