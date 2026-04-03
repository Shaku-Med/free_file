/**
 * Plain-language copy for passkeys. Avoid distinct errors on sign-in that could
 * hint whether an account exists, has passkeys, or is unverified.
 */
export const PasskeyUserMessage = {
  loginDidNotWork:
    "Passkey sign-in didn't work. Try again, or sign in with your password.",
  loginStartFailed:
    "We couldn't use a passkey right now. Try again, or use your password.",
  tryAgainLater: "Something went wrong. Please try again in a moment.",
  confirmEmailFirst: "Confirm your email first, then you can add a passkey.",
  signInAgain: "Please sign in again.",
  rateLimited: "Too many tries. Wait a bit, then try again.",
  addPasskeyFailed: "We couldn't add that passkey. Try again.",
  passkeyAlreadySaved: "That passkey is already on your account.",
  removePasskeyFailed: "We couldn't remove that passkey. Try again.",
  loadPasskeysFailed: "We couldn't load your passkeys. Refresh the page and try again.",
  cancelled: "Sign-in was cancelled.",
} as const;

type PasskeyClientContext = "login" | "register";

/** Map browser / WebAuthn exceptions to short copy (never show raw DOMException text). */
export function friendlyPasskeyClientError(
  err: unknown,
  context: PasskeyClientContext = "login"
): string {
  const fallback =
    context === "register" ? PasskeyUserMessage.addPasskeyFailed : PasskeyUserMessage.loginDidNotWork;
  if (!(err instanceof Error)) {
    return fallback;
  }
  const name = err.name || "";
  const msg = (err.message || "").toLowerCase();
  if (name === "NotAllowedError" || msg.includes("not allowed")) {
    return fallback;
  }
  if (name === "AbortError" || msg.includes("abort")) {
    return PasskeyUserMessage.cancelled;
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return PasskeyUserMessage.tryAgainLater;
  }
  return fallback;
}
