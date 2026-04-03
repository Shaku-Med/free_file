/**
 * WebAuthn RP config. Prefer WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN in production
 * so passkeys work behind proxies and on the real hostname.
 */
export function getWebAuthnConfig(request: Request): {
  rpID: string;
  rpName: string;
  origin: string;
} {
  const url = new URL(request.url);
  const rpID =
    (typeof process !== "undefined" && process.env.WEBAUTHN_RP_ID?.trim()) ||
    url.hostname;
  const origin =
    (typeof process !== "undefined" && process.env.WEBAUTHN_ORIGIN?.trim()) ||
    url.origin;
  const rpName =
    (typeof process !== "undefined" && process.env.WEBAUTHN_RP_NAME?.trim()) ||
    "Memories";
  return { rpID, rpName, origin };
}
