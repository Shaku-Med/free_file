import type { FileType, SeriesEpisodeGroup } from "~/lib/types";

export function mapSeriesRpcRowToFileType(row: Record<string, unknown>): FileType {
  return {
    id: String(row.id),
    created_at: String(row.created_at ?? ""),
    endpoint: String(row.endpoint ?? ""),
    filename: String(row.filename ?? ""),
    unique_id: String(row.unique_id ?? ""),
    file_size: row.file_size != null ? String(row.file_size) : "",
    file_type: String(row.file_type ?? ""),
    is_adult: Boolean(row.is_adult),
    owner_id: row.owner_id != null ? String(row.owner_id) : undefined,
    is_public: row.is_public !== false,
    file_description:
      typeof row.file_description === "string" ? row.file_description : undefined,
    file_title: typeof row.file_title === "string" ? row.file_title : "",
    default_thumbnail:
      typeof row.default_thumbnail === "string" ? row.default_thumbnail : null,
    view_count: row.view_count,
    share_count: row.share_count,
    is_reel: Boolean(row.is_reel),
    duration: row.duration != null ? Number(row.duration) : undefined,
    categories: row.categories as FileType["categories"],
    tags: row.tags as FileType["tags"],
    colors: row.colors,
    metadata: row.metadata,
    like_count: Number(row.like_count) || 0,
    dislike_count: Number(row.dislike_count) || 0,
    comment_count: Number(row.comment_count) || 0,
    upload_status: typeof row.upload_status === "string" ? row.upload_status : undefined,
    owner: row.owner_username
      ? {
          id: String(row.owner_id ?? ""),
          username: String(row.owner_username),
          profile_pic: String(row.owner_profile_pic ?? ""),
          verified: Boolean(row.owner_verified),
          about: (row.owner_about as string | null) ?? null,
        }
      : null,
  };
}

/** RPC rows are ordered by episode then item; preserves order via Map insertion. */
export function groupSeriesRpcRows(rows: Record<string, unknown>[]): SeriesEpisodeGroup[] {
  const order: string[] = [];
  const map = new Map<string, SeriesEpisodeGroup>();

  for (const row of rows) {
    const eid = String(row.episode_id ?? "");
    if (!eid) continue;
    if (!map.has(eid)) {
      order.push(eid);
      map.set(eid, {
        episode_id: eid,
        episode_name: typeof row.episode_name === "string" ? row.episode_name : "",
        episode_number:
          row.episode_number != null && row.episode_number !== ""
            ? Number(row.episode_number)
            : null,
        items: [],
      });
    }
    map.get(eid)!.items.push(mapSeriesRpcRowToFileType(row));
  }

  return order.map((id) => map.get(id)!);
}

/** Flatten episodes in RPC order (episode order, then items per episode). */
export function flattenSeriesEpisodesInOrder(episodes: SeriesEpisodeGroup[]): FileType[] {
  const out: FileType[] = [];
  for (const ep of episodes) {
    for (const item of ep.items) {
      out.push(item);
    }
  }
  return out;
}

/** All series file unique_ids (for deduping related suggestions on the end screen). */
export function collectSeriesMemberIds(episodes: SeriesEpisodeGroup[] | null | undefined): Set<string> {
  const s = new Set<string>();
  if (!episodes?.length) return s;
  for (const ep of episodes) {
    for (const item of ep.items) {
      if (item.unique_id) s.add(item.unique_id);
    }
  }
  return s;
}

/** Videos that play after `currentUniqueId` in series order (empty if not in series or last item). */
export function getSeriesUpNextVideos(
  episodes: SeriesEpisodeGroup[] | null | undefined,
  currentUniqueId: string
): FileType[] {
  if (!episodes?.length || !currentUniqueId) return [];
  const flat = flattenSeriesEpisodesInOrder(episodes);
  const idx = flat.findIndex((v) => v.unique_id === currentUniqueId);
  if (idx < 0) return [];
  return flat.slice(idx + 1);
}
