import { useLocation } from "react-router";

// Same-origin path only. Mirrors the server-side safeServerRedirect rules so
// the ?redirect= we attach is always accepted post-login.
function sanitizeReturnTo(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.length > 500) return null;
  if (path.startsWith("/auth/")) return null; // don't loop back into auth
  return path;
}

/** Build a login href that returns the user to `returnTo` after sign-in. */
export function buildLoginHref(returnTo?: string | null): string {
  const safe = sanitizeReturnTo(returnTo);
  return safe ? `/auth/login?redirect=${encodeURIComponent(safe)}` : "/auth/login";
}

/** Build a signup href that returns to `returnTo` after the flow completes. */
export function buildSignupHref(returnTo?: string | null): string {
  const safe = sanitizeReturnTo(returnTo);
  return safe ? `/auth/signup?redirect=${encodeURIComponent(safe)}` : "/auth/signup";
}

/** Current-location-aware login/signup hrefs for sign-in CTAs. */
export function useAuthHrefs() {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  return {
    loginHref: buildLoginHref(returnTo),
    signupHref: buildSignupHref(returnTo),
    returnTo: sanitizeReturnTo(returnTo) ?? "/",
  };
}
