import db from "~/lib/Database/supabase";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { sanitizeFeedCard } from "~/lib/files/sanitizeFileForViewer";
import type { FileType } from "~/lib/types";

export const SAVED_PAGE_SIZE = 24;

const FILE_COLUMNS =
  "id, unique_id, file_title, file_description, file_type, default_thumbnail, preview_endpoint, " +
  "view_count, share_count, is_reel, duration, categories, tags, owner_id, endpoint, filename, " +
  "created_at, is_public, visibility, is_adult, upload_status, is_series_main, is_files_series_item, file_series_id";

type OwnerRow = { id: string; username: string | null; profile_pic: string | null; verified: boolean | null };

/**
 * One page of the viewer's own saves, newest first, shaped like feed cards.
 * Only ever called with the signed in viewer's id, so nobody can read
 * anyone else's. A video made private after it was saved is dropped by the
 * same access check the feed uses.
 */
export async function listSavedFiles(
  request: Request,
  viewerId: string,
  offset: number,
): Promise<{ files: FileType[]; nextOffset: number | null }> {
  if (!db) throw new Error("Database unavailable");

  const { data, error } = await db
    .from("saved_files")
    .select(`files:file_id (${FILE_COLUMNS})`)
    .eq("user_id", viewerId)
    .order("created_at", { ascending: false })
    // One extra row says whether another page exists.
    .range(offset, offset + SAVED_PAGE_SIZE);
  if (error) throw new Error(`saved_files: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{ files: Record<string, unknown> | null }>;
  const hasMore = rows.length > SAVED_PAGE_SIZE;
  const files = rows
    .slice(0, SAVED_PAGE_SIZE)
    .map((r) => r.files)
    .filter((f): f is Record<string, unknown> => Boolean(f));
  const accessible = (await filterFilesByAccess(request, files as never[])) as Record<string, unknown>[];

  const ownerIds = [...new Set(accessible.map((f) => String(f.owner_id ?? "")).filter(Boolean))];
  const owners = new Map<string, OwnerRow>();
  if (ownerIds.length > 0) {
    const { data: ownerRows } = await db.from("users").select("id, username, profile_pic, verified").in("id", ownerIds);
    for (const o of (ownerRows ?? []) as OwnerRow[]) owners.set(o.id, o);
  }

  const cards = accessible.map((f) => {
    const o = owners.get(String(f.owner_id ?? ""));
    return sanitizeFeedCard(
      {
        ...f,
        owner: o?.username
          ? { id: o.id, username: o.username, profile_pic: o.profile_pic ?? "", verified: o.verified === true }
          : null,
      },
      viewerId,
    ) as unknown as FileType;
  });

  return { files: cards, nextOffset: hasMore ? offset + SAVED_PAGE_SIZE : null };
}
