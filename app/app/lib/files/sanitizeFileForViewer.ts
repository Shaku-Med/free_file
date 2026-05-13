/**
 * Hides upload pipeline details from anyone except the file owner.
 * `processing_progress` must never be exposed to guests or non-owning users in SSR/JSON.
 */
export function sanitizeFileForPublicViewer<T extends Record<string, unknown>>(
  file: T,
  viewerUserId: string | null
): T {
  const ownerId =
    file.owner_id != null && file.owner_id !== ""
      ? String(file.owner_id)
      : null;
  const isOwner = Boolean(
    viewerUserId && ownerId && viewerUserId === ownerId
  );
  if (isOwner) return file;
  const { processing_progress: _omit, ...rest } = file;
  return rest as T;
}
