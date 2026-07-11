import { verifyWebhookSecret } from "~/lib/Security/webhookAuth.server";
import { verifyUploadToken } from "~/lib/Security/uploadToken.server";
import db from "~/lib/Database/supabase";

// GET /api/upload-server-check — GoUpload verifies its upload_token bearer here (webhook secret required).
export const loader = async ({ request }: { request: Request }) => {
  try {
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
