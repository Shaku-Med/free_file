import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { sanitizeSearchQuery } from "~/lib/Security/inputValidation";

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
  const q = sanitizeSearchQuery(url.searchParams.get("q"));

  let qbuilder = db
    .from("files")
    .select("file_title, file_series_id")
    .eq("owner_id", user.id)
    .eq("is_series_main", true)
    .not("file_series_id", "is", null);

  if (q) {
    qbuilder = qbuilder.ilike("file_title", `%${q}%`);
  }

  const { data: rows, error } = await qbuilder.order("created_at", { ascending: false }).limit(50);

  if (error) {
    console.error("[my-series]", error);
    return data({ error: "Failed to load series" }, { status: 500 });
  }

  const series = (rows ?? [])
    .map((r: { file_title?: unknown; file_series_id?: unknown }) => ({
      file_title: typeof r.file_title === "string" ? r.file_title : "",
      file_series_id: r.file_series_id != null ? String(r.file_series_id) : "",
    }))
    .filter((s: { file_series_id: string }) => s.file_series_id.length > 0);

  return data({ series }, { status: 200 });
};
