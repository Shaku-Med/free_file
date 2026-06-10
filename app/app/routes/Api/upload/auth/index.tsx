import { getCookie } from "~/lib/Security/Token";
import { isAuthenticated } from "~/lib/Security/Password";

/**
 * GET /api/upload/auth
 *
 * =============================================================================
 * UPLOAD AUTH (GoUpload only)
 * =============================================================================
 * Returns the GoUpload Bearer token from the HttpOnly c_user cookie.
 * Client uploads MUST go through GoUpload — never POST files to /api/upload
 * (legacy, server-to-server only; see routes/Api/upload/index.tsx).
 *
 * DO NOT re-expose c_user in root loader or add /api/upload browser fallbacks.
 * =============================================================================
 */
export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const c_user = getCookie("c_user", request.headers);
    if (!c_user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const uploadServerUrl = (
      process.env.UPLOAD_SERVER_URL ||
      process.env.GO_UPLOAD_URL ||
      ""
    ).replace(/\/$/, "");

    if (!uploadServerUrl) {
      return new Response(JSON.stringify({ error: "upload_server_not_configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        bearer: c_user,
        upload_server_url: uploadServerUrl,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
};
