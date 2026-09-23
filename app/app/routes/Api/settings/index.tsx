import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { parseUserTheme } from "~/lib/theme/constants";
import { invalidateUserAccessContextById } from "~/lib/Services/accessCache.server";

const toJson = (body: unknown, status = 200) => data(body, { status });

const BASE_COLUMNS = ["show_nsfw", "theme", "history_paused"] as const;

/**
 * Columns a database may not have yet because its migration has not been run.
 * Rather than fail the whole settings page, the query drops the missing one and
 * tells the client, which keeps its own copy of that preference.
 */
const OPTIONAL_COLUMNS = ["snap_floats_to_corners", "background_playback"] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

type PgError = { message?: string; code?: string } | null;
type UserRow = Record<string, unknown>;

/** 42703 is Postgres "undefined column"; the message normally names it. */
function missingColumns(
  error: PgError,
  candidates: readonly OptionalColumn[],
): OptionalColumn[] {
  if (!error || candidates.length === 0) return [];
  const msg = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
  const named = candidates.filter((c) => msg.includes(c));
  if (named.length > 0) return named;
  // Undefined column with nothing named: we cannot tell which, so drop them all.
  return msg.includes("42703") ? [...candidates] : [];
}

type SettingsResult =
  | { row: UserRow | null; missing: Set<OptionalColumn>; error?: undefined }
  | { row?: undefined; missing: Set<OptionalColumn>; error: NonNullable<PgError> };

async function readSettings(userId: string): Promise<SettingsResult> {
  const missing = new Set<OptionalColumn>();
  let optional: OptionalColumn[] = [...OPTIONAL_COLUMNS];
  for (;;) {
    const res = await db!
      .from("users")
      .select(["id", ...BASE_COLUMNS, ...optional].join(", "))
      .eq("id", userId)
      .single();
    if (!res.error) return { row: res.data as UserRow, missing };
    const gone = missingColumns(res.error, optional);
    if (gone.length === 0) return { error: res.error, missing };
    gone.forEach((c) => missing.add(c));
    optional = optional.filter((c) => !gone.includes(c));
  }
}

async function writeSettings(
  userId: string,
  updates: Record<string, unknown>,
): Promise<SettingsResult> {
  const missing = new Set<OptionalColumn>();
  const pending = { ...updates };
  for (;;) {
    const live = OPTIONAL_COLUMNS.filter((c) => !missing.has(c));
    if (Object.keys(pending).length === 0) return { row: null, missing };
    const res = await db!
      .from("users")
      .update(pending)
      .eq("id", userId)
      .select([...BASE_COLUMNS, ...live].join(", "))
      .single();
    if (!res.error) return { row: res.data as UserRow, missing };
    const gone = missingColumns(res.error, live);
    if (gone.length === 0) return { error: res.error, missing };
    gone.forEach((c) => {
      missing.add(c);
      delete pending[c];
    });
  }
}

/** Server value when the column exists, otherwise what the client asked for. */
function resolveFlag(
  row: UserRow | null,
  column: OptionalColumn,
  missing: Set<OptionalColumn>,
  requested: unknown,
): boolean {
  if (!missing.has(column) && row && column in row) return row[column] === true;
  return requested === true;
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

    const { row, missing, error } = await readSettings(user.id);
    if (error) {
      console.error("Failed to load settings:", error);
      return toJson({ error: "Failed to load settings" }, 500);
    }

    const theme = parseUserTheme(row?.theme ?? null);
    return toJson({
      showNsfw: row?.show_nsfw === true,
      historyPaused: row?.history_paused === true,
      snapFloatsToCorners: row?.snap_floats_to_corners === true,
      snapColumnMissing: missing.has("snap_floats_to_corners") || undefined,
      backgroundPlayback: row?.background_playback === true,
      backgroundPlaybackColumnMissing: missing.has("background_playback") || undefined,
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
    const {
      showNsfw,
      historyPaused,
      snapFloatsToCorners,
      backgroundPlayback,
      theme: themePayload,
    } = body || {};

    const updates: Record<string, unknown> = {};

    if (typeof showNsfw === "boolean") {
      updates.show_nsfw = showNsfw;
    }

    if (typeof historyPaused === "boolean") {
      updates.history_paused = historyPaused;
    }

    if (typeof snapFloatsToCorners === "boolean") {
      updates.snap_floats_to_corners = snapFloatsToCorners;
    }

    if (typeof backgroundPlayback === "boolean") {
      updates.background_playback = backgroundPlayback;
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

    const { row, missing, error } = await writeSettings(user.id, updates);
    if (error) {
      console.error("Failed to update settings:", error);
      return toJson({ error: "Failed to update settings" }, 500);
    }

    invalidateUserAccessContextById(user.id);

    const theme = parseUserTheme(row?.theme ?? null);
    return toJson({
      success: true,
      showNsfw: row ? row.show_nsfw === true : showNsfw === true,
      historyPaused: row ? row.history_paused === true : historyPaused === true,
      snapFloatsToCorners: resolveFlag(row, "snap_floats_to_corners", missing, snapFloatsToCorners),
      snapColumnMissing: missing.has("snap_floats_to_corners") || undefined,
      backgroundPlayback: resolveFlag(row, "background_playback", missing, backgroundPlayback),
      backgroundPlaybackColumnMissing: missing.has("background_playback") || undefined,
      theme: theme ?? { theme: "system", style: "default" },
    }, 200);
  } catch (error) {
    console.error("Settings action error:", error);
    return toJson({ error: "Internal server error" }, 500);
  }
};
