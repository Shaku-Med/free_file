import type { FileType } from '~/lib/types';
import { IMAGE_BASE_URL } from '~/lib/URLS';
import { loadAuthHeaders } from '~/lib/loadAuth.client';

// Hover preview source + a process-wide blob cache, so a card that has already
// been hovered never refetches.

const MAX_CACHED = 40;
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();
// Previews that came back missing (older uploads have no .webm). Asking again
// on every hover would only repeat the same 404 against LoadNodeServer.
const missing = new Set<string>();

/**
 * Storage path of the preview, or null when the row has none.
 *
 * Requires the real column. Deriving it from default_thumbnail would make every
 * old card fetch a 404 on hover, since uploads from before this feature have no
 * preview file at all.
 */
export function previewPathFor(file: Partial<FileType> | null | undefined): string | null {
  const explicit = (file as { preview_endpoint?: unknown } | null | undefined)?.preview_endpoint;
  if (typeof explicit === 'string') {
    const path = explicit.trim();
    return path ? path : null;
  }
  return null;
}

type PreviewFormat = 'mp4' | 'webm';
let playableFormat: PreviewFormat | null | undefined;

// Some Chromium builds answer "" to canPlayType for H.264 and still play it,
// so either check saying yes counts. Firefox without a decoder says no to both.
function supports(type: string): boolean {
  const probe = document.createElement('video');
  return Boolean(probe.canPlayType(type)) || (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type));
}

/**
 * The preview format this browser can actually decode. Firefox on Linux only
 * plays H.264 through the system's ffmpeg, which many installs lack, but it
 * always has VP9; GoUpload writes a .webm copy next to the .mp4 for that case.
 * Null means neither, so the card skips the preview instead of fetching it.
 */
function previewFormat(): PreviewFormat | null {
  if (playableFormat !== undefined) return playableFormat;
  if (typeof document === 'undefined') return 'mp4';
  playableFormat = supports('video/mp4; codecs="avc1.4D401E"')
    ? 'mp4'
    : supports('video/webm; codecs="vp9"')
      ? 'webm'
      : null;
  return playableFormat;
}

/**
 * The browser claimed H.264 but an MP4 preview failed to decode, as Firefox on
 * Linux does when only OpenH264 is there: it decodes Baseline only and calls
 * anything else corrupt. Use the WebM copies for the rest of the visit.
 * True when there is a WebM to try.
 */
export function preferWebm(): boolean {
  if (playableFormat !== 'mp4' || typeof document === 'undefined') return false;
  playableFormat = supports('video/webm; codecs="vp9"') ? 'webm' : null;
  return playableFormat === 'webm';
}

/**
 * Always LoadNodeServer. Adult/private cannot load standalone there — the
 * fetch must send `Authorization: Bearer <load token>` (see loadPreview).
 */
export function previewUrlFor(file: Partial<FileType> | null | undefined): string | null {
  const path = previewPathFor(file);
  if (!path) return null;
  const format = previewFormat();
  if (!format) return null;
  const chosen = format === 'webm' ? path.replace(/\.mp4$/i, '.webm') : path;
  return `${IMAGE_BASE_URL}/api/load/preview/${chosen}`;
}

export function needsAuthenticatedFetch(file: Partial<FileType> | null | undefined): boolean {
  if (!file) return false;
  if (file.is_adult) return true;
  const v = (file as { visibility?: string | null }).visibility;
  if (v === 'private') return true;
  if (v == null && file.is_public === false) return true;
  return false;
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
  needsAuth = false,
): Promise<string | null> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  if (missing.has(url)) return Promise.resolve(null);

  const pending = inFlight.get(url);
  if (pending) return pending;

  const p = (async () => {
    try {
      const headers: Record<string, string> = {};
      if (needsAuth) {
        const auth = await loadAuthHeaders();
        Object.assign(headers, auth);
      }
      const res = await fetch(url, {
        signal,
        mode: 'cors',
        credentials: 'omit',
        headers,
      });
      if (res.status === 404) missing.add(url);
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
