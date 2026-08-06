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
  // Raw classifier output kept for reviewing false positives. It can name what
  // the detector thought it saw, so it is review material, not viewer material.
  // The owner learns their file is locked through `moderation_flag`, which is
  // returned by the owner-only edit RPC rather than smuggled onto every row.
  "moderation_evidence",
  "moderation_flag",
  "moderation_flagged_at",
  "moderation_reviewed_at",
  "visibility_before_flag",
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
  // `metadata` can't just be deleted (the player needs the video dimensions), so
  // it's reduced to an allowlist instead. Done HERE rather than in each loader
  // because this function is the single client boundary every file row passes
  // through — watch page, related, series, PiP, feeds. Patching callers
  // individually is how the watch page kept leaking after the reel path was
  // fixed.
  if ("metadata" in clean) {
    clean.metadata = sanitizeMetadataForClient(clean.metadata);
  }
  return clean as T;
}

/**
 * Player-safe view of `files.metadata`.
 *
 * The stored blob is an INTERNAL analysis record: Google Vision labels and their
 * confidence scores, safeSearch moderation verdicts (adult / racy / violence /
 * medical), loudness measurements, music scoring, and derived text analysis.
 * Serialising that into SSR JSON publishes how content is classified and
 * moderated — visible in view-source — and bloats every page.
 *
 * ALLOWLIST, so anything the upload pipeline adds later stays server-side by
 * default. Only what the client genuinely reads survives:
 *   - video width / height / aspect_ratio → size the player frame before any
 *     bytes load, which is what stops the layout jumping
 *   - audio.has_audio → whether to enable the volume control on a silent clip
 */
export function sanitizeMetadataForClient(
  metadata: unknown,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, any>;
  const out: Record<string, unknown> = {};

  const v = m.video;
  if (v && typeof v === "object") {
    const width = Number(v.width) || null;
    const height = Number(v.height) || null;
    out.video = {
      width,
      height,
      aspect_ratio:
        typeof v.aspect_ratio === "string" && v.aspect_ratio.includes(":")
          ? v.aspect_ratio
          : width && height
            ? `${width}:${height}`
            : null,
    };
  }

  const a = m.audio;
  if (a && typeof a === "object") {
    out.audio = { has_audio: a.has_audio !== false };
  }

  // Shown to the viewer verbatim, so it has to survive the allowlist.
  if (typeof m.warning === "string" && m.warning.trim()) {
    out.warning = m.warning;
  }

  // Intro / credits offsets drive the skip buttons and the owner's edit form.
  const mk = m.markers;
  if (mk && typeof mk === "object") {
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    out.markers = {
      introStart: num(mk.introStart),
      introEnd: num(mk.introEnd),
      creditsStart: num(mk.creditsStart),
    };
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Card-sized view of a file row for feeds, related lists, reels and play queues.
 *
 * Two things get dropped on top of the always-private set:
 *   - Everything the vision pass wrote into `metadata` (safeSearch verdicts,
 *     label confidences, the AI caption, loudness, codec/bitrate). None of it is
 *     rendered, and the safeSearch verdicts publish how content was classified.
 *   - `file_description`, `tags` and `captions`, which no card renders. They
 *     exist only to pre-seed the owner's edit modal, and that modal refetches
 *     from the owner-only endpoint anyway, so non-owners never need them.
 */
const OWNER_ONLY_CARD_FIELDS = ["file_description", "tags", "captions"] as const;

export function sanitizeFeedCard<T extends Record<string, unknown>>(
  file: T,
  viewerUserId: string | null,
): T {
  const clean = stripServerOnlyFileFields(file) as Record<string, unknown>;
  const ownerId =
    file.owner_id != null && file.owner_id !== "" ? String(file.owner_id) : null;
  if (!viewerUserId || !ownerId || viewerUserId !== ownerId) {
    for (const key of OWNER_ONLY_CARD_FIELDS) delete clean[key];
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
