import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server";
import { verifyUploadToken } from "~/lib/Security/uploadToken.server";
import db from "~/lib/Database/supabase";

/**
 * GET /api/upload-server-check
 * Called by the Go upload server to verify the user. The Go server sends:
 *   Authorization: Bearer <upload_token>
 *   X-Webhook-Secret: <UPLOAD_WEBHOOK_SECRET>
 * where upload_token is a short-lived token from /api/upload/auth (not c_user).
 * Returns 200 { userId, username } if valid, 401 if not.
 */
export const loader = async ({ request }: { request: Request }) => {
  try {
    // Only GoUpload (shared secret) may call this — never browsers.
    if (!verifyWebhookSecret(request)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const auth = request.headers.get("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const bearer = auth.slice(7).trim();
    if (!bearer) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!db) {
      return new Response(JSON.stringify({ error: "unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const upload = await verifyUploadToken(bearer);
    if (!upload) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: user, error } = await db
      .from("users")
      .select("id, username")
      .eq("c_usr", upload.c_usr)
      .eq("id", upload.uid)
      .maybeSingle();

    if (error || !user?.id) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        userId: user.id,
        username: typeof user.username === "string" ? user.username : "",
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
