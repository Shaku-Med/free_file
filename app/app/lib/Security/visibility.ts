/**
 * File visibility, in one place.
 *
 * Three states, matching the `file_visibility` enum:
 *
 *   public    listed everywhere, reachable by anyone
 *   unlisted  NEVER listed, reachable by anyone holding the link
 *   private   never listed, reachable only by the owner
 *
 * Listing is enforced in SQL rather than here: `files.is_public` is kept as
 * (visibility = 'public') by a database trigger, and every feed, search and RPC
 * already filters on it. So unlisted and private fall out of listings for free.
 * What this module decides is DIRECT access, which is the part SQL can't do.
 *
 * Moderation forces two of these and locks them (see the migration):
 *   adult   -> unlisted
 *   harmful -> private, until a human clears it
 */

export type FileVisibility = 'public' | 'unlisted' | 'private';

export const VISIBILITY_VALUES: readonly FileVisibility[] = [
  'public',
  'unlisted',
  'private',
] as const;

export function isFileVisibility(value: unknown): value is FileVisibility {
  return (
    value === 'public' || value === 'unlisted' || value === 'private'
  );
}

/**
 * Read a row's visibility.
 *
 * Falls back to the legacy boolean for any row or code path that predates the
 * column. Note the fallback resolves to 'private', never 'unlisted': if we
 * cannot tell what a row is, the safe reading of `is_public = false` is the
 * more restrictive one.
 */
export function visibilityOf(file: {
  visibility?: unknown;
  is_public?: unknown;
}): FileVisibility {
  if (isFileVisibility(file?.visibility)) return file.visibility;
  return file?.is_public === false || file?.is_public === 'false'
    ? 'private'
    : 'public';
}

/** Whether this visibility may be reached by someone who is not the owner. */
export function allowsDirectAccess(v: FileVisibility): boolean {
  return v === 'public' || v === 'unlisted';
}

/** Whether a row may appear in feeds, search, related lists and so on. */
export function allowsListing(v: FileVisibility): boolean {
  return v === 'public';
}

/**
 * Whether the OWNER is allowed to change this file's visibility.
 *
 * Locked is set by moderation and cleared only by review. This is the app side
 * check; the database trigger enforces the same rule independently, so an API
 * bug that forwards a client supplied field still cannot flip a locked file.
 */
export function canOwnerChangeVisibility(file: {
  visibility_locked?: unknown;
}): boolean {
  return file?.visibility_locked !== true;
}
