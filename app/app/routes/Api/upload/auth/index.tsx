import { getCookie } from "~/lib/Security/Token";
import { isAuthenticated } from "~/lib/Security/Password";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";
import { mintUploadToken } from "~/lib/Security/uploadToken.server";
import { DecryptCombine } from "~/lib/Security/unsharedkeyEncryption/Combined/Combined";
import { getAllKeys } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys";

/**
 * GET /api/upload/auth
 *
 * =============================================================================
 * UPLOAD AUTH (GoUpload only)
 * =============================================================================
 * Mints a short-lived upload-scoped bearer (NOT the c_user session JWT).
 * Client uploads MUST go through GoUpload — never POST files to /api/upload
 * (legacy, server-to-server only; see routes/Api/upload/index.tsx).
 *
 * DO NOT re-expose c_user in root loader or add /api/upload browser fallbacks.
 * =============================================================================
 */
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

    const c_user = getCookie("c_user", request.headers);
    if (!c_user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const keys = await getAllKeys(["token1", "c_user"]);
    if (!keys) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const decoded = await DecryptCombine(c_user, keys);
    if (!decoded || typeof decoded !== "object" || typeof decoded.c_usr !== "string") {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const bearer = await mintUploadToken({
      c_usr: decoded.c_usr,
      userId: user.id,
    });
    if (!bearer) {
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
        bearer,
        upload_server_url: uploadServerUrl,
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
