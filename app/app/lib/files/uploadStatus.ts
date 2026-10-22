const PROCESSING_STATES = new Set(["queued", "running", "processing", "pending", "uploading"]);

/**
 * How long a live video's higher qualities count as still encoding. Past it, a
 * row whose worker crashed before clearing the flag is treated as done again.
 */
export const PENDING_QUALITIES_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * True while an upload has nothing playable yet. A video stops being "still
 * processing" the moment its first quality is live (status complete), even if
 * higher ones are still encoding. Legacy rows with no status count as done.
 */
export function isStillProcessing(status: unknown): boolean {
  return typeof status === "string" && PROCESSING_STATES.has(status.toLowerCase());
}

/**
 * True while a live video's higher qualities are still encoding: the worker
 * keeps processing_progress set past completion until every quality is in.
 */
export function hasPendingQualities(file: {
  upload_status?: unknown;
  processing_progress?: unknown;
  created_at?: unknown;
}): boolean {
  return (
    !isStillProcessing(file.upload_status) &&
    typeof file.processing_progress === "number" &&
    Date.now() - Date.parse(String(file.created_at)) < PENDING_QUALITIES_MAX_MS
  );
}
