import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { parseUserTheme } from "~/lib/theme/constants";
import { invalidateUserAccessContextById } from "~/lib/Services/accessCache.server";

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
      .select("id, show_nsfw, theme, history_paused")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("Failed to load settings:", error);
      return toJson({ error: "Failed to load settings" }, 500);
    }

    const theme = parseUserTheme(settings?.theme ?? null);
    return toJson({
      showNsfw: settings?.show_nsfw ?? false,
      historyPaused: settings?.history_paused === true,
      theme: theme ?? { theme: "system", style: "default" },
    }, 200);
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
    const { showNsfw, historyPaused, theme: themePayload } = body || {};

    const updates: {
      show_nsfw?: boolean;
      history_paused?: boolean;
      theme?: { theme: string; style: string };
    } = {};

    if (typeof showNsfw === "boolean") {
      updates.show_nsfw = showNsfw;
    }

    if (typeof historyPaused === "boolean") {
      updates.history_paused = historyPaused;
    }

    if (themePayload != null) {
      const theme = parseUserTheme(themePayload);
      if (theme) {
        updates.theme = { theme: theme.theme, style: theme.style };
      }
    }

    if (Object.keys(updates).length === 0) {
      return toJson({ error: "No valid fields to update" }, 400);
    }

    const { data: updated, error } = await db
      .from("users")
      .update(updates)
      .eq("id", user.id)
      .select("show_nsfw, theme, history_paused")
      .single();

    if (error) {
      console.error("Failed to update settings:", error);
      return toJson({ error: "Failed to update settings" }, 500);
    }

    // show_nsfw toggle changes access-control outcomes (adult content gated by it)
    // drop the cached user context so the next request revalidates.
    invalidateUserAccessContextById(user.id);

    const theme = parseUserTheme(updated?.theme ?? null);
    return toJson({
      success: true,
      showNsfw: updated?.show_nsfw,
      historyPaused: updated?.history_paused === true,
      theme: theme ?? { theme: "system", style: "default" },
    }, 200);
  } catch (error) {
    console.error("Settings action error:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
