const MOBILE_UA_RE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

/**
 * Server-side mobile detection from the User-Agent header.
 * Covers phones, tablets, and common mobile browsers.
 */
export function isMobileUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return MOBILE_UA_RE.test(ua);
}
