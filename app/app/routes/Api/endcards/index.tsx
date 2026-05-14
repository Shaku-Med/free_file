import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { isValidUUID } from "~/lib/Security/inputValidation";

const respond = (body: unknown, status = 200, maxAgeSeconds = 0) =>
  data(body, {
    status,
    headers: {
      "Cache-Control":
        maxAgeSeconds > 0
          ? `private, max-age=${maxAgeSeconds}`
          : "no-store",
    },
  });

/**
 * GET /api/endcards?file_id=<uuid>
 *
 * Returns up to 4 lightweight suggestion rows for the end-card overlay that
 * shows during the last ~20 seconds of playback. The rows include only what
 * the non-interactive card grid renders (thumbnail, title, owner, duration,
 * view count) — no likes, no comments, no full file row.
 */
export const loader = async ({ request }: { request: Request }) => {
  if (!db) return respond({ error: "unavailable" }, 503);

  const url = new URL(request.url);
  const fileId = (url.searchParams.get("file_id") || "").trim();
  if (!isValidUUID(fileId)) {
    return respond({ error: "invalid file_id" }, 400);
  }

  const limitRaw = Number(url.searchParams.get("limit") || "4");
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(8, Math.floor(limitRaw)))
    : 4;

  // exclude_ids = comma-separated UUIDs of files the caller is already showing
  // elsewhere on the page (related rail, series up-next, etc). Capped at 100
  // to keep the URL bounded and skip silently on malformed entries.
  const excludeRaw = url.searchParams.get("exclude_ids") || "";
  const excludeIds = excludeRaw
    ? excludeRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => isValidUUID(s))
        .slice(0, 100)
    : [];

  // Optional auth — used only as a personalization hint by `get_related`.
  // Guests still get suggestions, just unpersonalized.
  const user = await isAuthenticated(request, ["id"]);
  const userId = user && typeof user === "object" && user.id ? user.id : null;

  try {
    const { data: rows, error } = await db.rpc("get_video_endcards", {
      p_file_id: fileId,
      p_user_id: userId,
      p_limit: limit,
      p_exclude_ids: excludeIds,
    });
    if (error) {
      console.error("[api/endcards] rpc:", error);
      return respond({ error: "rpc failed" }, 500);
    }
    return respond({ suggestions: Array.isArray(rows) ? rows : [] }, 200, 60);
  } catch (e) {
    console.error("[api/endcards] error:", e);
    return respond({ error: "internal" }, 500);
  }
};
