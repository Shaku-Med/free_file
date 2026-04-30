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
    view_count: (() => {
      const v = row.view_count;
      if (v == null) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    })(),
    share_count: (() => {
      const v = row.share_count;
      if (v == null) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    })(),
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
    processing_progress: (() => {
      const v = row.processing_progress;
      if (v == null || v === "") return undefined;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return undefined;
      return Math.min(100, Math.max(0, Math.round(n)));
    })(),
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
    const parentRaw =
      row.parent_episode_id ??
      (row as Record<string, unknown>).parentEpisodeId;
    const parent_episode_id =
      parentRaw != null && String(parentRaw).trim() !== ""
        ? String(parentRaw)
        : null;
    if (!map.has(eid)) {
      order.push(eid);
      map.set(eid, {
        episode_id: eid,
        episode_name: typeof row.episode_name === "string" ? row.episode_name : "",
        episode_number:
          row.episode_number != null && row.episode_number !== ""
            ? Number(row.episode_number)
            : null,
        parent_episode_id,
        items: [],
      });
    }
    map.get(eid)!.items.push(mapSeriesRpcRowToFileType(row));
  }

  const roots: SeriesEpisodeGroup[] = [];
  const childrenByParent = new Map<string, SeriesEpisodeGroup[]>();

  for (const id of order) {
    const g = map.get(id)!;
    const pid = g.parent_episode_id;
    if (!pid || !map.has(pid)) {
      roots.push(g);
    } else {
      let arr = childrenByParent.get(pid);
      if (!arr) {
        arr = [];
        childrenByParent.set(pid, arr);
      }
      arr.push(g);
    }
  }

  const attachNested = (node: SeriesEpisodeGroup) => {
    const kids = childrenByParent.get(node.episode_id);
    if (kids?.length) {
      node.nested = sortEpisodeGroups(kids.map((k) => {
        attachNested(k);
        return k;
      }));
    }
  };

  for (const r of roots) attachNested(r);
  return sortEpisodeGroups(roots);
}

/**
 * Earliest `created_at` among the items in this episode (and recursively, its nested episodes).
 * That date is the only thing that's reliably present and meaningful regardless of how the user
 * named things — it's when the FIRST piece of content in this branch was uploaded, which is the
 * natural "first / middle / last" ordering people actually want.
 */
function earliestItemTimestamp(group: SeriesEpisodeGroup): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const item of group.items) {
    const t = item.created_at ? new Date(item.created_at).getTime() : NaN;
    if (Number.isFinite(t) && t < earliest) earliest = t;
  }
  if (group.nested) {
    for (const child of group.nested) {
      const t = earliestItemTimestamp(child);
      if (Number.isFinite(t) && t < earliest) earliest = t;
    }
  }
  return earliest;
}

/**
 * Order siblings the way the user expects, regardless of naming:
 *   1) explicit `episode_number` if both have it (manual override)
 *   2) earliest upload time in the branch — first uploaded → first, last uploaded → last
 *   3) name fallback (numeric-collation locale compare) when timestamps are missing/equal
 *
 * The RPC returns alphabetical, which is wrong as soon as users name things freely.
 * Going by upload time means "any name" works — the user doesn't have to follow a
 * convention to get the right order.
 */
function sortEpisodeGroups(groups: SeriesEpisodeGroup[]): SeriesEpisodeGroup[] {
  return [...groups].sort((a, b) => {
    if (a.episode_number != null && b.episode_number != null && a.episode_number !== b.episode_number) {
      return a.episode_number - b.episode_number;
    }
    if (a.episode_number != null && b.episode_number == null) return -1;
    if (a.episode_number == null && b.episode_number != null) return 1;

    const ta = earliestItemTimestamp(a);
    const tb = earliestItemTimestamp(b);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    if (Number.isFinite(ta) && !Number.isFinite(tb)) return -1;
    if (!Number.isFinite(ta) && Number.isFinite(tb)) return 1;

    return (a.episode_name ?? "").localeCompare(b.episode_name ?? "", undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function walkEpisodesDepthFirst(episodes: SeriesEpisodeGroup[], visit: (ep: SeriesEpisodeGroup) => void) {
  for (const ep of episodes) {
    visit(ep);
    if (ep.nested?.length) walkEpisodesDepthFirst(ep.nested, visit);
  }
}

/** Flatten episodes in RPC order (episode order, then items per episode). */
export function flattenSeriesEpisodesInOrder(episodes: SeriesEpisodeGroup[]): FileType[] {
  const out: FileType[] = [];
  walkEpisodesDepthFirst(episodes, (ep) => {
    for (const item of ep.items) {
      out.push(item);
    }
  });
  return out;
}

/** All series file unique_ids (for deduping related suggestions on the end screen). */
export function collectSeriesMemberIds(episodes: SeriesEpisodeGroup[] | null | undefined): Set<string> {
  const s = new Set<string>();
  if (!episodes?.length) return s;
  walkEpisodesDepthFirst(episodes, (ep) => {
    for (const item of ep.items) {
      if (item.unique_id) s.add(item.unique_id);
    }
  });
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

/** Video that plays before `currentUniqueId` in series order (undefined if not in series or first item). */
export function getSeriesPreviousVideo(
  episodes: SeriesEpisodeGroup[] | null | undefined,
  currentUniqueId: string
): FileType | undefined {
  if (!episodes?.length || !currentUniqueId) return undefined;
  const flat = flattenSeriesEpisodesInOrder(episodes);
  const idx = flat.findIndex((v) => v.unique_id === currentUniqueId);
  if (idx <= 0) return undefined;
  return flat[idx - 1];
}
