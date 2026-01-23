import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";

const toJson = (body: unknown, status = 200) => data(body, { status });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user || !user.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (!db) {
      return toJson({ error: "Database not initialized" }, 500);
    }

    const { data: settings, error } = await db
      .from("users")
      .select("id, show_nsfw")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("Failed to load settings:", error);
      return toJson({ error: "Failed to load settings" }, 500);
    }

    return toJson({ showNsfw: settings?.show_nsfw ?? false }, 200);
  } catch (error) {
    console.error("Settings loader error:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "PATCH") {
      return toJson({ error: "Method not allowed" }, 405);
    }

    const user = await isAuthenticated(request, ["id"]);
    if (!user || !user.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (!db) {
      return toJson({ error: "Database not initialized" }, 500);
    }

    const body = await request.json();
    const { showNsfw } = body || {};

    if (typeof showNsfw !== "boolean") {
      return toJson({ error: "showNsfw must be boolean" }, 400);
    }

    const { data: updated, error } = await db
      .from("users")
      .update({ show_nsfw: showNsfw })
      .eq("id", user.id)
      .select("show_nsfw")
      .single();

    if (error) {
      console.error("Failed to update settings:", error);
      return toJson({ error: "Failed to update settings" }, 500);
    }

    return toJson({ success: true, showNsfw: updated?.show_nsfw ?? showNsfw }, 200);
  } catch (error) {
    console.error("Settings action error:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
