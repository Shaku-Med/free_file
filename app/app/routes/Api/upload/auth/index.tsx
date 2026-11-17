import { isAuthenticated } from "~/lib/Security/Password";
import { canAct } from "~/lib/Security/accountStatus.server";
import { assertSafeRequest } from "~/lib/Security/requestGuard.server";
import { mintUploadBearerForRequest } from "~/lib/Security/uploadToken.server";
import { rateLimiter } from "~/routes/Auth/fun/rateLimit.server";

// GET /api/upload/auth — mints a short-lived upload-scoped bearer for GoUpload; never expose c_user here.
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

    // A long upload renews its bearer every few minutes; this sits far above
    // that and stops a script minting tokens in a loop.
    const limit = await rateLimiter.checkLimit(user.id, "upload-auth", 30, 60_000, 5 * 60_000);
    if (!limit.allowed) {
      return new Response(JSON.stringify({ error: "too_many_requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // Account enforcement: a restricted/terminated account gets no upload
    // bearer, so GoUpload can't be handed a token at all. Blocking here rather
    // than inside GoUpload keeps the rule in one place — the upload server
    // simply never receives credentials.
    if (!(await canAct(user.id))) {
      return new Response(
        JSON.stringify({ error: "account_restricted" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const bearer = await mintUploadBearerForRequest(request, user.id);
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
