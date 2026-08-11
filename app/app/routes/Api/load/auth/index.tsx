import { isAuthenticated } from "~/lib/Security/Password";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";
import { mintLoadBearerForRequest } from "~/lib/Security/loadToken.server";
import { IMAGE_BASE_URL } from "~/lib/URLS";

// GET /api/load/auth — mints a short-lived load-scoped bearer for LoadNodeServer.
// Never exposes the HttpOnly c_user session JWT. Client sends it as
// `Authorization: Bearer <token>` on adult/private image + preview fetches.

export const loader = async ({ request }: { request: Request }) => {
  try {
    const blocked = assertSafeRequest(request);
    if (blocked) return blocked;

    if (request.headers.get("X-Requested-With") !== "fetch") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const bearer = await mintLoadBearerForRequest(request, user.id);
    if (!bearer) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const loadServerUrl = (
      process.env.LOAD_SERVER_URL ||
      process.env.IMAGE_BASE_URL ||
      IMAGE_BASE_URL ||
      ""
    ).replace(/\/$/, "");

    if (!loadServerUrl) {
      return new Response(JSON.stringify({ error: "load_server_not_configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        bearer,
        load_server_url: loadServerUrl,
        expires_in: 3600,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
};
