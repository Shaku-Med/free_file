/**
 * Batch-attaches `original_sound` (and a resolved `original_file_id`) to feed
 * file rows — the same shape the reel feed / watch loaders produce, so the reel
 * action-rail audio tile and the sound chip show the ORIGINAL sound a reel used
 * instead of falling back to the reel's own thumbnail.
 *
 * Some feed RPCs (e.g. `get_pip_feed`) don't return the original-sound columns,
 * so we look up `original_file_id` for the rows, then fetch the matched
 * originals in one round-trip. Only public, non-adult, completed originals are
 * exposed (mirrors the single-file enrichment in the reel watch loader).
 */

type AnyDb = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => Promise<{ data: unknown }>;
    };
  };
};

type FileRow = Record<string, unknown> & {
  id?: unknown;
  original_file_id?: unknown;
  original_sound?: unknown;
};

export async function attachOriginalSounds(db: AnyDb | null, files: FileRow[]): Promise<void> {
  if (!db || !Array.isArray(files) || files.length === 0) return;

  const ids = Array.from(
    new Set(files.map((f) => (f.id != null ? String(f.id) : "")).filter(Boolean)),
  );
  if (ids.length === 0) return;

  // Fill in original_file_id for any row that didn't carry it from the RPC.
  const origByFileId = new Map<string, string | null>();
  if (files.some((f) => f.original_file_id === undefined)) {
    const { data: rows } = await db.from("files").select("id, original_file_id").in("id", ids);
    if (Array.isArray(rows)) {
      for (const r of rows as Array<Record<string, unknown>>) {
        origByFileId.set(
          String(r.id),
          r.original_file_id ? String(r.original_file_id) : null,
        );
      }
    }
  }

  const resolveOrig = (f: FileRow): string | null => {
    if (f.original_file_id !== undefined && f.original_file_id !== null) {
      return String(f.original_file_id);
    }
    const id = f.id != null ? String(f.id) : "";
    return origByFileId.get(id) ?? null;
  };

  const originalIds = Array.from(
    new Set(files.map(resolveOrig).filter((x): x is string => Boolean(x))),
  );

  const soundById = new Map<string, Record<string, unknown>>();
  if (originalIds.length > 0) {
    const { data: origs } = await db
      .from("files")
      .select(
        "id, unique_id, file_title, filename, default_thumbnail, thumbnails, created_at, is_public, is_adult, upload_status",
      )
      .in("id", originalIds);
    if (Array.isArray(origs)) {
      for (const o of origs as Array<Record<string, unknown>>) {
        if (o.is_public === true && o.is_adult !== true && o.upload_status === "complete") {
          const fallbackThumb = Array.isArray(o.thumbnails)
            ? (o.thumbnails as string[]).find(
                (t) => typeof t === "string" && t.endsWith("thumbnail_preview.jpg"),
              ) ?? null
            : null;
          soundById.set(String(o.id), {
            unique_id: String(o.unique_id),
            file_title: o.file_title ?? null,
            filename: o.filename ?? null,
            default_thumbnail: o.default_thumbnail ?? fallbackThumb,
            created_at: o.created_at ?? null,
          });
        }
      }
    }
  }

  for (const f of files) {
    const orig = resolveOrig(f);
    f.original_file_id = orig;
    f.original_sound = orig ? soundById.get(orig) ?? null : null;
  }
}
