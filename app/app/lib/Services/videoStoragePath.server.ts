/**
 * GitHub / video API paths are always `{file.unique_id}/…` under `/api/load/video/`.
 * The first segment is the Supabase `unique_id`, regardless of nesting
 * (`uuid/master.m3u8`, `uuid/hls/playlist.m3u8`, etc.).
 */
export function uniqueIdFromVideoStoragePath(path: string): string | null {
  const first = path.split("/").filter(Boolean)[0];
  return first || null;
}
