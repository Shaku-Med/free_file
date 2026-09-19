import db from "~/lib/Database/supabase";
import { allowsListing, visibilityOf } from "~/lib/Security/visibility";
import { getHiddenOwnerIds } from "~/lib/Security/accountStatus.server";

/**
 * Playlist cover art: the most recently added file in the list that the whole
 * world is allowed to see.
 *
 * A cover is a listing surface, so it takes the listing rule rather than the
 * direct-access one. Unlisted and private files are reachable by link but must
 * never be advertised, and adult files are held unlisted by moderation. Picking
 * "the first item" with no filter, which is what the RPC used to do, turns a
 * playlist into a way to publish a thumbnail of something private.
 *
 * The owner is not exempt. These covers are rendered on the profile as well as
 * in the owner's own list, and one shape that cannot leak beats two that have
 * to agree about who is looking.
 */

/** Only what the thumbnail needs. Ids, endpoints and owner internals stay here. */
export interface PlaylistCover {
  unique_id: string;
  file_type: string;
  endpoint: string | null;
  created_at: string | null;
  default_thumbnail: string | null;
  thumbnails: string[] | null;
  is_reel: boolean;
  duration: number | null;
}

/** Rows scanned per call. Well past any real playlist page, and bounded. */
const MAX_SCAN_ROWS = 600;
/** A busy list can crowd out the window, so try the stragglers once more. */
const MAX_PASSES = 2;

interface ItemRow {
  playlist_id: string;
  added_at: string | null;
  files: FileRow | FileRow[] | null;
}

interface FileRow {
  unique_id: string | null;
  file_type: string | null;
  endpoint: string | null;
  created_at: string | null;
  default_thumbnail: string | null;
  thumbnails: unknown;
  is_reel: boolean | null;
  duration: number | null;
  is_adult: boolean | null;
  is_public: boolean | null;
  visibility: string | null;
  owner_id: string | null;
}

function fileOf(row: ItemRow): FileRow | null {
  if (!row.files) return null;
  return Array.isArray(row.files) ? row.files[0] ?? null : row.files;
}

function toThumbnails(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return out.length > 0 ? out : null;
}

/**
 * Resolves one cover per playlist id. Playlists with nothing showable are
 * simply absent from the map, and the caller falls back to its own artwork.
 */
export async function resolvePlaylistCovers(
  playlistIds: string[],
): Promise<Map<string, PlaylistCover>> {
  const covers = new Map<string, PlaylistCover>();
  const ids = [...new Set(playlistIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0 || !db) return covers;

  let pending = ids;
  for (let pass = 0; pass < MAX_PASSES && pending.length > 0; pass++) {
    await scan(pending, covers);
    pending = pending.filter((id) => !covers.has(id));
  }
  return covers;
}

async function scan(ids: string[], covers: Map<string, PlaylistCover>): Promise<void> {
  if (!db) return;
  const { data, error } = await db
    .from("playlist_items")
    .select(
      "playlist_id, added_at, files!inner(unique_id, file_type, endpoint, created_at, default_thumbnail, thumbnails, is_reel, duration, is_adult, is_public, visibility, owner_id)",
    )
    .in("playlist_id", ids)
    .order("added_at", { ascending: false })
    .limit(MAX_SCAN_ROWS);

  if (error || !Array.isArray(data)) {
    if (error) console.error("[playlistCovers] lookup failed:", error.message);
    return;
  }

  const rows = data as unknown as ItemRow[];

  // Candidates first, so the moderation lookup is one batched call rather than
  // one per playlist.
  const candidates: Array<{ playlistId: string; file: FileRow }> = [];
  for (const row of rows) {
    const file = fileOf(row);
    if (!file || !file.unique_id) continue;
    if (file.is_adult === true) continue;
    if (!allowsListing(visibilityOf(file))) continue;
    candidates.push({ playlistId: String(row.playlist_id), file });
  }
  if (candidates.length === 0) return;

  const hidden = await getHiddenOwnerIds(candidates.map((c) => c.file.owner_id ?? null));

  // Rows arrive newest first, so the first survivor for a playlist is its cover.
  for (const { playlistId, file } of candidates) {
    if (covers.has(playlistId)) continue;
    if (file.owner_id && hidden.has(String(file.owner_id))) continue;
    covers.set(playlistId, {
      unique_id: String(file.unique_id),
      file_type: String(file.file_type ?? "video"),
      endpoint: file.endpoint ?? null,
      created_at: file.created_at ?? null,
      default_thumbnail: file.default_thumbnail ?? null,
      thumbnails: toThumbnails(file.thumbnails),
      is_reel: file.is_reel === true,
      duration: typeof file.duration === "number" ? file.duration : null,
    });
  }
}
