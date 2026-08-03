import type { FileType } from '~/lib/types';

// Hover preview source + a process-wide blob cache, so a card that has already
// been hovered never refetches.

const MAX_CACHED = 40;
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Storage path of the preview. Prefers the column; falls back to deriving it
 * from default_thumbnail, which sits in the same directory. The fallback is
 * what makes this work on surfaces whose SQL does not return the column yet.
 */
export function previewPathFor(file: Partial<FileType> | null | undefined): string | null {
  if (!file) return null;
  if (file.is_reel) return null;
  if (typeof file.file_type === 'string' && !file.file_type.startsWith('video/')) return null;

  const explicit = (file as { preview_endpoint?: unknown }).preview_endpoint;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

  const thumb = typeof file.default_thumbnail === 'string' ? file.default_thumbnail : '';
  if (!thumb.includes('/')) return null;
  return thumb.replace(/[^/]+$/, 'hover_preview.mp4');
}

export function previewUrlFor(file: Partial<FileType> | null | undefined): string | null {
  const path = previewPathFor(file);
  return path ? `/api/load/preview/${path}` : null;
}

export function cachedPreview(url: string): string | undefined {
  return cache.get(url);
}

/**
 * Fetches once per URL. Concurrent callers share the same request, and the
 * blob URL is kept so re-hovering is instant.
 */
export function loadPreview(url: string, signal?: AbortSignal): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);

  const pending = inFlight.get(url);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch(url, { credentials: 'same-origin', signal });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.size) return null;
      const objectUrl = URL.createObjectURL(blob);

      if (cache.size >= MAX_CACHED) {
        const oldest = cache.keys().next().value;
        if (oldest) {
          const stale = cache.get(oldest);
          if (stale) URL.revokeObjectURL(stale);
          cache.delete(oldest);
        }
      }
      cache.set(url, objectUrl);
      return objectUrl;
    } catch {
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, p);
  return p;
}
