/** Common keys returned by playlist list RPCs for cover art. */
const THUMB_KEYS = [
  "thumbnail_url",
  "first_thumb",
  "cover_url",
  "thumb_url",
  "playlist_thumbnail",
  "first_thumbnail_url",
  "image_url",
  "first_file_thumbnail",
  "cover_image",
  "cover_thumb",
  "default_thumbnail",
] as const;

function firstNonEmptyString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export function pickPlaylistThumbnail(p: Record<string, unknown>): string | null {
  const fromKeys = firstNonEmptyString(...THUMB_KEYS.map((k) => p[k]));
  if (fromKeys) return fromKeys;
  return null;
}

/** Shape used by profile + playlist list UIs. */
export function mapPlaylistRpcToClientRow(p: Record<string, unknown>) {
  const thumb = pickPlaylistThumbnail(p);
  return {
    id: String(p.id ?? ""),
    title: String(p.title ?? "Untitled"),
    description: p.description != null ? String(p.description) : null,
    is_public: p.is_public === true || p.is_public === 1 || p.is_public === "true",
    unique_id: String(p.unique_id ?? p.id ?? ""),
    item_count:
      Number(p.item_count ?? p.total_items ?? p.playlist_item_count ?? 0) || 0,
    thumbnail_url: thumb,
    first_thumb: thumb,
  };
}
