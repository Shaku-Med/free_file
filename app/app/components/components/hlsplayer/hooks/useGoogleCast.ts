import { useCallback, useEffect, useState } from 'react';

/**
 * Google Cast (Chromecast) sender integration.
 *
 * The Remote Playback API (useRemotePlayback) can't cast an hls.js/MSE stream
 * on desktop Chrome  only Safari/AirPlay works there. Chrome/Android cast via
 * the Google Cast SDK with the default media receiver, which plays HLS
 * natively. The TV fetches the stream itself, so we mint a cast-scoped URL
 * (/api/play/cast-mint) it's actually allowed to load.
 *
 * The SDK + context are a single global singleton initialised ONCE here; every
 * mounted button just subscribes to state. (Per-component init clobbered the
 * one global __onGCastApiAvailable callback, so only one button ever worked.)
 */

const CAST_SDK_SRC =
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

type AnyWin = typeof window & {
  cast?: any;
  chrome?: any;
  __onGCastApiAvailable?: (available: boolean) => void;
};

export interface CastMediaPayload {
  /** files.unique_id  used to mint the cast URL. */
  fileId: string;
  title?: string;
  /** Absolute poster URL the receiver can fetch (optional). */
  poster?: string;
  /** Resume position in seconds. */
  currentTime?: number;
}

interface CastState {
  available: boolean;
  casting: boolean;
}

let sdkInjected = false;
let contextReady = false;
let castContext: any = null;
let current: CastState = { available: false, casting: false };
const listeners = new Set<(s: CastState) => void>();

function emit() {
  for (const l of listeners) l(current);
}

function initCastSingleton() {
  if (typeof window === 'undefined' || contextReady) return;
  const w = window as AnyWin;

  const doInit = () => {
    if (contextReady) return;
    if (!w.cast?.framework || !w.chrome?.cast) return;
    contextReady = true;
    try {
      castContext = w.cast.framework.CastContext.getInstance();
      castContext.setOptions({
        receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      const CS = w.cast.framework.CastState;
      const sync = () => {
        const st = castContext.getCastState();
        current = {
          available: st !== CS.NO_DEVICES_AVAILABLE,
          casting: st === CS.CONNECTED,
        };
        emit();
      };
      castContext.addEventListener(
        w.cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        sync,
      );
      sync();
    } catch (e) {
      console.warn('[cast] init failed', e);
      contextReady = false;
    }
  };

  // SDK already loaded (e.g. a remount): init straight away.
  if (w.cast?.framework && w.chrome?.cast) {
    doInit();
    return;
  }

  // Chain (don't clobber) any pre-existing callback, then inject the SDK once.
  const prev = w.__onGCastApiAvailable;
  w.__onGCastApiAvailable = (isAvailable: boolean) => {
    if (typeof prev === 'function') {
      try {
        prev(isAvailable);
      } catch {
        /* ignore */
      }
    }
    if (isAvailable) doInit();
    else console.warn('[cast] SDK reported unavailable (needs HTTPS / supported browser)');
  };

  if (!sdkInjected && typeof document !== 'undefined') {
    sdkInjected = true;
    const s = document.createElement('script');
    s.src = CAST_SDK_SRC;
    s.async = true;
    s.onerror = () => console.warn('[cast] failed to load cast_sender.js');
    document.head.appendChild(s);
  }
}

async function mintCastUrl(fileId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/play/cast-mint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ fileId }),
    });
    if (!res.ok) {
      console.warn('[cast] cast-mint failed', res.status);
      return null;
    }
    const data = (await res.json()) as { url?: string };
    return typeof data.url === 'string' ? data.url : null;
  } catch (e) {
    console.warn('[cast] cast-mint error', e);
    return null;
  }
}

export function useGoogleCast() {
  const [state, setState] = useState<CastState>(current);

  useEffect(() => {
    initCastSingleton();
    listeners.add(setState);
    setState(current);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  /** Open the device picker (if needed) and load the file onto the receiver. */
  const startCast = useCallback(async (payload: CastMediaPayload) => {
    if (typeof window === 'undefined') return;
    const w = window as AnyWin;
    const ctx = castContext ?? w.cast?.framework?.CastContext?.getInstance?.();
    if (!ctx || !w.chrome?.cast || !payload.fileId) {
      console.warn('[cast] not ready to cast', { ready: contextReady, fileId: payload.fileId });
      return;
    }
    try {
      // requestSession opens the device picker (must run during the click).
      if (!ctx.getCurrentSession()) {
        await ctx.requestSession();
      }
      const session = ctx.getCurrentSession();
      if (!session) return;

      const url = await mintCastUrl(payload.fileId);
      if (!url) return;

      const mediaInfo = new w.chrome.cast.media.MediaInfo(url, 'application/x-mpegurl');
      mediaInfo.streamType = w.chrome.cast.media.StreamType.BUFFERED;
      mediaInfo.metadata = new w.chrome.cast.media.GenericMediaMetadata();
      if (payload.title) mediaInfo.metadata.title = payload.title;
      if (payload.poster) {
        mediaInfo.metadata.images = [new w.chrome.cast.Image(payload.poster)];
      }

      const request = new w.chrome.cast.media.LoadRequest(mediaInfo);
      if (payload.currentTime && Number.isFinite(payload.currentTime)) {
        request.currentTime = Math.max(0, Math.floor(payload.currentTime));
      }
      await session.loadMedia(request);
    } catch (e) {
      // Cancelled picker is a string code ('cancel'); real failures are worth logging.
      if (e && e !== 'cancel') console.warn('[cast] startCast failed', e);
    }
  }, []);

  const stopCast = useCallback(() => {
    if (typeof window === 'undefined') return;
    const w = window as AnyWin;
    const ctx = castContext ?? w.cast?.framework?.CastContext?.getInstance?.();
    try {
      ctx?.endCurrentSession(true);
    } catch {
      /* no active session */
    }
  }, []);

  return { castAvailable: state.available, isCasting: state.casting, startCast, stopCast };
}
