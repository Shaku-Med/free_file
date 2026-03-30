import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidUUID } from "~/lib/Security/inputValidation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await isAuthenticated(request, ["id"]);
  if (!user?.id) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  if (!db) {
    return data({ error: "Database not initialized" }, { status: 500 });
  }

  const url = new URL(request.url);
  const fileSeriesId = url.searchParams.get("file_series_id")?.trim() ?? "";
  if (!fileSeriesId || !isValidUUID(fileSeriesId)) {
    return data({ error: "Invalid file_series_id" }, { status: 400 });
  }

  const { data: ser, error: serErr } = await db
    .from("file_series")
    .select("id")
    .eq("id", fileSeriesId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (serErr || !ser) {
    return data({ error: "Series not found" }, { status: 404 });
  }

  const { data: episodes, error: epErr } = await db
    .from("files_series_episodes")
    .select("id, episode_name")
    .eq("feed_series_id", fileSeriesId)
    .eq("owner_id", user.id)
    .order("episode_number", { ascending: true, nullsFirst: true })
    .order("episode_name", { ascending: true });

  if (epErr) {
    console.error("[series-episodes]", epErr);
    return data({ error: "Failed to load episodes" }, { status: 500 });
  }

  const list = (episodes ?? []).map((e: { id: unknown; episode_name?: unknown }) => ({
    id: String(e.id),
    episode_name: typeof e.episode_name === "string" ? e.episode_name : "",
  }));

  return data({ episodes: list }, { status: 200 });
};
