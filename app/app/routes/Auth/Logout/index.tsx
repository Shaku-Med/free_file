import { redirect, type LoaderFunctionArgs } from "react-router";

// Server-side logout: clear auth/session cookies and redirect to login
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Build headers with multiple Set-Cookie directives to expire cookies
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

  // Optionally, clear any non-HttpOnly copies if they ever existed
  headers.append(
    "Set-Cookie",
    "token=; Path=/; Max-Age=0; SameSite=Strict"
  );
  headers.append(
    "Set-Cookie",
    "c_user=; Path=/; Max-Age=0; SameSite=Strict"
  );

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirect") || "/auth/login";

  return redirect(redirectTo, { headers });
};

export default function Logout() {
  // This component should never actually render because the loader redirects.
  return null;
}

