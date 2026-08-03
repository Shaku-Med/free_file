/**
 * Merges files.preview_endpoint onto RPC rows.
 *
 * The feed functions return a fixed RETURNS TABLE shape, and adding a column to
 * each one means editing roughly twenty functions plus every SELECT inside them.
 * One batched lookup here does the same job without touching them.
 */
export async function attachPreviewEndpoints<T extends Record<string, unknown>>(
  dbClient: { from: (t: string) => any } | null,
  rows: T[],
): Promise<T[]> {
  if (!dbClient || rows.length === 0) return rows;
  if (rows.some((r) => 'preview_endpoint' in r)) return rows;

  const ids = Array.from(
    new Set(rows.map((r) => r.id).filter((v): v is string => typeof v === 'string' && !!v)),
  );
  if (ids.length === 0) return rows;

  const { data, error } = await dbClient
    .from('files')
    .select('id, preview_endpoint')
    .in('id', ids)
    .not('preview_endpoint', 'is', null);

  // A missing column or a failed lookup just means no previews this page.
  if (error || !Array.isArray(data)) return rows;

  const byId = new Map<string, string>();
  for (const row of data as Array<{ id?: unknown; preview_endpoint?: unknown }>) {
    if (typeof row.id === 'string' && typeof row.preview_endpoint === 'string') {
      byId.set(row.id, row.preview_endpoint);
    }
  }
  if (byId.size === 0) return rows;

  return rows.map((r) =>
    typeof r.id === 'string' && byId.has(r.id)
      ? ({ ...r, preview_endpoint: byId.get(r.id) } as T)
      : r,
  );
}
