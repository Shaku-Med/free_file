import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const action = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user?.id) return toJson({ error: "Unauthorized" }, 401);
    if (!db) return toJson({ error: "Something went wrong." }, 500);

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const endpoint = body?.endpoint;
      const keys = body?.keys;
      if (!endpoint || typeof endpoint !== "string") {
        return toJson({ error: "Something went wrong." }, 400);
      }
      if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
        return toJson({ error: "Something went wrong." }, 400);
      }

      const { error } = await db.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        { onConflict: "endpoint" }
      );

      if (error) {
        console.error("push-subscribe error:", error);
        return toJson({ error: "Something went wrong." }, 500);
      }
      return toJson({ success: true });
    }

    if (request.method === "DELETE") {
      const body = await request.json().catch(() => ({}));
      const endpoint = body?.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return toJson({ error: "Something went wrong." }, 400);
      }

      const { error } = await db
        .from("push_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .eq("endpoint", endpoint);

      if (error) {
        console.error("push-unsubscribe error:", error);
        return toJson({ error: "Something went wrong." }, 500);
      }
      return toJson({ success: true });
    }

    return toJson({ error: "Something went wrong." }, 405);
  } catch (e) {
    console.error("push-subscribe action:", e);
    return toJson({ error: "Something went wrong." }, 500);
  }
};
