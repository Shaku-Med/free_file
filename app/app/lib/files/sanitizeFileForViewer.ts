/**
 * Server-only columns on `files` that must NEVER reach the browser  for any viewer, the
 * owner included. The watch-page loader fetches the row with `select('*')`, so without this
 * scrub they get serialized straight into the SSR / hydration JSON, where "view source"
 * exposes them. Two kinds of data live here:
 *   - Uploader PII: the upload IP address and the geolocation derived from it. The uploader
 *     is the file owner, so leaving these in leaks the owner's IP + city to every viewer.
 *   - Server-only internals the client never reads: the semantic-search embedding vector
 *     (also huge  bloats every page), the search index text, the moderation counters, and
 *     the storage backend / bucket the file physically lives in.
 */
const ALWAYS_PRIVATE_FILE_FIELDS = [
  "upload_ip",
  "upload_country",
  "upload_country_name",
  "upload_region",
  "upload_city",
  "upload_timezone",
  "upload_user_agent",
  "embedding",
  "search_text",
  "report_count",
  "report_status",
  "storage_backend",
  "storage_bucket",
] as const;

/**
 * Removes the server-only / PII columns from a file row. Use this on any list of file rows
 * that gets serialized to the client but has no single "viewer vs owner" notion (play queue,
 * series episodes, PiP feed  rows belong to many different owners). Returns a fresh object.
 */
export function stripServerOnlyFileFields<T extends Record<string, unknown>>(file: T): T {
  const clean: Record<string, unknown> = { ...file };
  for (const key of ALWAYS_PRIVATE_FILE_FIELDS) {
    delete clean[key];
  }
  return clean as T;
}

/**
 * Strips the server-only / PII columns above before a file row is sent to the client, and
 * additionally hides `processing_progress` (upload pipeline state) from everyone except the
 * owner. Always returns a fresh object  the input row is left untouched for any further
 * server-side use.
 */
export function sanitizeFileForPublicViewer<T extends Record<string, unknown>>(
  file: T,
  viewerUserId: string | null
): T {
  const clean: Record<string, unknown> = stripServerOnlyFileFields(file);

  const ownerId =
    file.owner_id != null && file.owner_id !== ""
      ? String(file.owner_id)
      : null;
  const isOwner = Boolean(viewerUserId && ownerId && viewerUserId === ownerId);
  if (!isOwner) {
    delete clean.processing_progress;
  }

  return clean as T;
}
