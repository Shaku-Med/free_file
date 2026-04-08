import { redirect, type LoaderFunctionArgs } from "react-router";
import { clearAltAccountsCookie } from "~/lib/Security/accountVault";

/** Same-origin path only; avoids open redirects. Blocks `/logout` to prevent redirect loops. */
function safePostLogoutRedirect(request: Request, redirectParam: string | null): string {
  if (!redirectParam) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(redirectParam);
  } catch {
    return "/";
  }
  const base = new URL(request.url);
  let parsed: URL;
  try {
    parsed = new URL(decoded, base);
  } catch {
    return "/";
  }
  if (parsed.origin !== base.origin) return "/";
  if (parsed.pathname === "/logout") return "/";
  return parsed.pathname + parsed.search + parsed.hash;
}

// Server-side logout: clear ALL auth/session cookies including the multi-account vault
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const headers = new Headers();

  // Core auth cookies
  headers.append(
    "Set-Cookie",
    "token=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
  );
  headers.append(
    "Set-Cookie",
    "c_user=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
  );

  // Session / handshake cookies
  headers.append(
    "Set-Cookie",
    "sessionId=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
  );

  // Media playback / validator cookies (best-effort clear)
  headers.append(
    "Set-Cookie",
    "videoToken=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
  );
  headers.append(
    "Set-Cookie",
    "validator=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
  );

  // Clear any non-HttpOnly copies if they ever existed
  headers.append(
    "Set-Cookie",
    "token=; Path=/; Max-Age=0; SameSite=Strict"
  );
  headers.append(
    "Set-Cookie",
    "c_user=; Path=/; Max-Age=0; SameSite=Strict"
  );

  // Wipe the multi-account vault so parked sessions can't be resumed after logout
  clearAltAccountsCookie(headers);

  const url = new URL(request.url);
  const redirectTo = safePostLogoutRedirect(request, url.searchParams.get("redirect"));

  return redirect(redirectTo, { headers });
};

export default function Logout() {
  // This component should never actually render because the loader redirects.
  return null;
}

