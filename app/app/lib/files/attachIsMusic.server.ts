import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The feed / related / search / profile RPCs don't return the `is_music`
 * column, so the card music icon only lights up where we add it back. This
 * batch-fetches is_music for a list of file rows (by id) and sets it on each,
 * in place. Best-effort: if the column isn't there yet it silently no-ops.
 *
 * Cheap: one indexed `id IN (...)` query for the whole page of cards.
 */
export async function attachIsMusic<T extends { id?: unknown }>(
  dbClient: SupabaseClient | null | undefined,
  files: T[],
): Promise<T[]> {
  if (!dbClient || !Array.isArray(files) || files.length === 0) return files;
  const ids = files
    .map((f) => (typeof f.id === "string" ? f.id : null))
    .filter((id): id is string => !!id);
  if (ids.length === 0) return files;

  try {
    const { data } = await dbClient.from("files").select("id, is_music").in("id", ids);
    if (!Array.isArray(data)) return files;
    const musicIds = new Set<string>();
    for (const r of data) {
      const row = r as { id?: unknown; is_music?: unknown };
      if (row.is_music === true && typeof row.id === "string") musicIds.add(row.id);
    }
    for (const f of files) {
      (f as { is_music?: boolean }).is_music = typeof f.id === "string" && musicIds.has(f.id);
    }
  } catch {
    // is_music column not deployed yet  leave cards without the icon.
  }
  return files;
}
