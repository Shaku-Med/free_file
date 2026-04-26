/**
 * Video API paths under `/api/load/video/` mirror GitHub storage. The file row’s
 * `unique_id` may be nested after a date or folder prefix, e.g.
 * `16_04_2026/8c10a02af861dfbdcb55b7d42742c9b6/master.m3u8` → unique_id is
 * `8c10a02af861dfbdcb55b7d42742c9b6`, not `16_04_2026`.
 *
 * We try directory segments from **deepest to shallowest** until Supabase returns a row.
 */

export function uniqueIdCandidatesFromVideoStoragePath(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return [];

  const last = parts[parts.length - 1];
  const hasFilename = last.includes(".");
  const dirParts =
    hasFilename && parts.length >= 2
      ? parts.slice(0, -1)
      : hasFilename && parts.length === 1
        ? []
        : parts;

  if (dirParts.length === 0) return [];

  const reversed = [...dirParts].reverse();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of reversed) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
