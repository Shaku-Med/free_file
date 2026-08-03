import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidFileId } from "~/lib/Security/inputValidation";

const toJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const loader = async ({ request }: { request: Request }) => {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");

    if (!fileId || !isValidFileId(fileId)) {
      return toJson({ error: "Invalid fileId" }, 400);
    }

    const limit = Math.min(Math.max(parseInt(limitParam || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(offsetParam || "0", 10) || 0, 0);

    if (!db) return toJson({ error: "unavailable" }, 503);

    const user = await isAuthenticated(request, ["id"]).catch(() => null);
    if (!user?.id) return toJson({ error: "Unauthorized" }, 401);

    // Get the thumbnails array and owner_id for the file
    const { data: fileRow, error } = await db
      .from("files")
      .select("owner_id, thumbnails, default_thumbnail, preview_endpoint")
      .eq(isValidFileId(fileId) ? "id" : "unique_id", fileId)
      .maybeSingle();

    if (error || !fileRow) return toJson({ error: "File not found" }, 404);
    if (fileRow.owner_id !== user.id) return toJson({ error: "Forbidden" }, 403);

    const stripQuotes = (s: unknown): string => {
      if (typeof s !== "string") return String(s ?? "");
      return s.replace(/^"|"$/g, "");
    };
    const allThumbs: string[] = Array.isArray(fileRow.thumbnails)
      ? fileRow.thumbnails
          .map(stripQuotes)
          .filter(
            (t: string) =>
              t &&
              // Seek-preview sprite and the full-quality cover grid are NOT
              // real frames  never offer them as a selectable thumbnail.
              !t.includes("thumbnail_preview") &&
              !t.includes("thumbnail_grid") &&
              !t.endsWith(".json") &&
              !t.includes("waveform")
          )
      : [];

    const total = allThumbs.length;
    const page = allThumbs.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return toJson({
      thumbnails: page,
      total,
      offset,
      limit,
      hasMore,
      default_thumbnail: fileRow.default_thumbnail ? stripQuotes(fileRow.default_thumbnail) : null,
    });
  } catch {
    return toJson({ error: "Internal server error" }, 500);
  }
};
