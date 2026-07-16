import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { parseUserTheme } from "~/lib/theme/constants";
import { invalidateUserAccessContextById } from "~/lib/Services/accessCache.server";

const toJson = (body: unknown, status = 200) => data(body, { status });

function isMissingSnapColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
  return msg.includes("snap_floats_to_corners") || msg.includes("42703");
}

export const loader = async ({ request }: { request: Request }) => {
  try {
    const user = await isAuthenticated(request, ["id"]);
    if (!user || !user.id) {
      return toJson({ error: "Unauthorized" }, 401);
    }

    if (!db) {
      return toJson({ error: "Database not initialized" }, 500);
    }

    const withSnap = await db
      .from("users")
      .select("id, show_nsfw, theme, history_paused, snap_floats_to_corners")
      .eq("id", user.id)
      .single();

    if (withSnap.error && isMissingSnapColumnError(withSnap.error)) {
      const fallback = await db
        .from("users")
        .select("id, show_nsfw, theme, history_paused")
        .eq("id", user.id)
        .single();
      if (fallback.error) {
        console.error("Failed to load settings:", fallback.error);
        return toJson({ error: "Failed to load settings" }, 500);
      }
      const theme = parseUserTheme(fallback.data?.theme ?? null);
      return toJson({
        showNsfw: fallback.data?.show_nsfw ?? false,
        historyPaused: fallback.data?.history_paused === true,
        snapFloatsToCorners: false,
        snapColumnMissing: true,
        theme: theme ?? { theme: "system", style: "default" },
      }, 200);
    }

    if (withSnap.error) {
      console.error("Failed to load settings:", withSnap.error);
      return toJson({ error: "Failed to load settings" }, 500);
    }

    const settings = withSnap.data;
    const theme = parseUserTheme(settings?.theme ?? null);
    return toJson({
      showNsfw: settings?.show_nsfw ?? false,
      historyPaused: settings?.history_paused === true,
      snapFloatsToCorners: settings?.snap_floats_to_corners === true,
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
    const { showNsfw, historyPaused, snapFloatsToCorners, theme: themePayload } = body || {};

    const updates: {
      show_nsfw?: boolean;
      history_paused?: boolean;
      snap_floats_to_corners?: boolean;
      theme?: { theme: string; style: string };
    } = {};

    if (typeof showNsfw === "boolean") {
      updates.show_nsfw = showNsfw;
    }

    if (typeof historyPaused === "boolean") {
      updates.history_paused = historyPaused;
    }

    if (typeof snapFloatsToCorners === "boolean") {
      updates.snap_floats_to_corners = snapFloatsToCorners;
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

    let { data: updated, error } = await db
      .from("users")
      .update(updates)
      .eq("id", user.id)
      .select("show_nsfw, theme, history_paused, snap_floats_to_corners")
      .single();

    // Column not migrated yet: save everything else, keep snap in the client only.
    if (error && isMissingSnapColumnError(error) && "snap_floats_to_corners" in updates) {
      const { snap_floats_to_corners: _drop, ...rest } = updates;
      if (Object.keys(rest).length === 0) {
        return toJson({
          success: true,
          snapFloatsToCorners: snapFloatsToCorners === true,
          snapColumnMissing: true,
        }, 200);
      }
      const retry = await db
        .from("users")
        .update(rest)
        .eq("id", user.id)
        .select("show_nsfw, theme, history_paused")
        .single();
      updated = retry.data as typeof updated;
      error = retry.error;
      if (!error) {
        invalidateUserAccessContextById(user.id);
        const theme = parseUserTheme(updated?.theme ?? null);
        return toJson({
          success: true,
          showNsfw: updated?.show_nsfw,
          historyPaused: updated?.history_paused === true,
          snapFloatsToCorners: snapFloatsToCorners === true,
          snapColumnMissing: true,
          theme: theme ?? { theme: "system", style: "default" },
        }, 200);
      }
    }

    if (error) {
      console.error("Failed to update settings:", error);
      return toJson({ error: "Failed to update settings" }, 500);
    }

    invalidateUserAccessContextById(user.id);

    const theme = parseUserTheme(updated?.theme ?? null);
    return toJson({
      success: true,
      showNsfw: updated?.show_nsfw,
      historyPaused: updated?.history_paused === true,
      snapFloatsToCorners: updated?.snap_floats_to_corners === true,
      theme: theme ?? { theme: "system", style: "default" },
    }, 200);
  } catch (error) {
    console.error("Settings action error:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
