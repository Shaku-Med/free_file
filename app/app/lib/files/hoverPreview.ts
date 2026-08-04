import type { FileType } from '~/lib/types';
import { IMAGE_BASE_URL } from '~/lib/URLS';

// Hover preview source + a process-wide blob cache, so a card that has already
// been hovered never refetches.

const MAX_CACHED = 40;
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Storage path of the preview, or null when the row has none.
 *
 * Requires the real column. Deriving it from default_thumbnail would make every
 * old card fetch a 404 on hover, since uploads from before this feature have no
 * preview file at all.
 */
export function previewPathFor(file: Partial<FileType> | null | undefined): string | null {
  const explicit = (file as { preview_endpoint?: unknown } | null | undefined)?.preview_endpoint;
  if (typeof explicit !== 'string') return null;
  const path = explicit.trim();
  return path ? path : null;
}

/**
 * Adult goes SAME ORIGIN so the session cookie reaches the app's loader, which
 * is the same rule ImageLoad follows (hasAdultTag forces an authenticated
 * fetch). Everything else goes to LoadNodeServer.
 */
export function previewUrlFor(file: Partial<FileType> | null | undefined): string | null {
  const path = previewPathFor(file);
  if (!path) return null;
  if (needsAuthenticatedFetch(file)) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/api/load/preview/${path}`;
  }
  return `${IMAGE_BASE_URL}/api/load/preview/${path}`;
}

export function needsAuthenticatedFetch(file: Partial<FileType> | null | undefined): boolean {
  return Boolean(file?.is_adult);
}

export function cachedPreview(url: string): string | undefined {
  return cache.get(url);
}

/**
 * Fetches once per URL. Concurrent callers share the same request, and the
 * blob URL is kept so re-hovering is instant.
 */
export function loadPreview(
  url: string,
  signal?: AbortSignal,
  sameOrigin = false,
): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);

  const pending = inFlight.get(url);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetch(url, {
        signal,
        ...(sameOrigin
          ? { credentials: 'include' as const }
          : { mode: 'cors' as const }),
      });
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
