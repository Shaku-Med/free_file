/**
 * Server secret resolution that fails CLOSED.
 *
 * A missing env var commonly collapses into one of three bogus values that
 * then get used as an HMAC/signing key: the empty string (`process.env.X || ""`),
 * the literal "undefined", or the literal "null" (e.g. `String(process.env.X)`
 * or a `${process.env.X}` template). Signing or verifying with any of those is
 * effectively having no secret at all — an attacker who knows the scheme can
 * forge tokens.
 *
 * `resolveSecret` returns the first *real* candidate (trimmed, non-empty, and
 * not the strings "undefined"/"null"), or null. `requireSecret` throws when
 * none is usable, so the caller fails closed: a verify returns false (access
 * denied) and a mint 500s (no token issued) instead of trusting a blank key.
 */

const BOGUS = new Set(["", "undefined", "null"]);

export function resolveSecret(
  ...candidates: Array<string | undefined | null>
): string | null {
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const v = c.trim();
    if (BOGUS.has(v)) continue;
    return v;
  }
  return null;
}

export function requireSecret(
  label: string,
  ...candidates: Array<string | undefined | null>
): string {
  const v = resolveSecret(...candidates);
  if (!v) {
    throw new Error(
      `[secretEnv] No usable secret for "${label}" — every candidate env var is ` +
        `unset/blank. Refusing to sign or verify with an empty key (set one of them).`,
    );
  }
  return v;
}
