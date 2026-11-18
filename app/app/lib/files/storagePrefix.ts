/** The only storage-directory shape GoUpload will purge: one upload's folder. */
export const STORAGE_PREFIX_PATTERN = /^\d{2}_\d{2}_\d{4}\/([a-f0-9]{32})\//;

/**
 * A file's own storage directory ({dd_mm_yyyy}/{upload_id}/), read from any
 * path it has stored. Only a folder named after this file's unique_id counts:
 * a path pointing into someone else's folder (default_thumbnail is owner
 * editable) must never turn a delete of this file into a purge of theirs.
 * Null when nothing matches, so nothing is purged.
 */
export function storagePrefixFor(
  row: {
    endpoint?: string | null;
    thumbnails?: unknown;
    default_thumbnail?: string | null;
  },
  uniqueId: string,
): string | null {
  const candidates: string[] = [];
  if (typeof row.endpoint === "string") candidates.push(row.endpoint);
  if (typeof row.default_thumbnail === "string") candidates.push(row.default_thumbnail);
  if (Array.isArray(row.thumbnails)) {
    for (const t of row.thumbnails) if (typeof t === "string") candidates.push(t);
  }
  for (const c of candidates) {
    const m = STORAGE_PREFIX_PATTERN.exec(c.replace(/^\/+/, ""));
    if (m && m[1] === uniqueId) return m[0];
  }
  return null;
}
