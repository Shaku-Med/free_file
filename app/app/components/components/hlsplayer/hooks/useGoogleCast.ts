import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Google Cast (Chromecast) sender integration.
 *
 * The Remote Playback API (useRemotePlayback) can't cast an hls.js/MSE stream
 * on desktop Chrome  only Safari/AirPlay works there. Chrome/Android cast via
 * the Google Cast SDK with the default media receiver, which plays HLS
 * natively. The TV fetches the stream itself, so we mint a cast-scoped URL
 * (/api/play/cast-mint) it's actually allowed to load.
 */

const CAST_SDK_SRC =
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

// Minimal shapes for the globals the SDK injects (no official types bundled).
type CastGlobals = {
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

let sdkInjected = false;

function injectCastSdk() {
  if (sdkInjected || typeof document === 'undefined') return;
  sdkInjected = true;
  const s = document.createElement('script');
  s.src = CAST_SDK_SRC;
  s.async = true;
  document.head.appendChild(s);
}

async function mintCastUrl(fileId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/play/cast-mint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ fileId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return typeof data.url === 'string' ? data.url : null;
  } catch {
    return null;
  }
}

export function useGoogleCast() {
  const [castAvailable, setCastAvailable] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as CastGlobals;

    const setup = () => {
      const cast = w.cast;
      const chrome = w.chrome;
      if (!cast?.framework || !chrome?.cast) return;
      if (readyRef.current) return;
      readyRef.current = true;

      const context = cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });

      const CastState = cast.framework.CastState;
      const syncState = () => {
        const state = context.getCastState();
        setCastAvailable(state !== CastState.NO_DEVICES_AVAILABLE);
        setIsCasting(state === CastState.CONNECTED);
      };
      syncState();

      context.addEventListener(
        cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        syncState,
      );
    };

    // The SDK calls this once it's loaded; also try immediately in case it
    // was already present from a prior mount.
    w.__onGCastApiAvailable = (available: boolean) => {
      if (available) setup();
    };
    if (w.cast?.framework && w.chrome?.cast) setup();
    else injectCastSdk();

    return () => {
      // Leave the context listener  the SDK is a singleton and we re-sync on
      // remount. Clearing __onGCastApiAvailable would break other players.
    };
  }, []);

  /** Open the device picker (if needed) and load the file onto the receiver. */
  const startCast = useCallback(async (payload: CastMediaPayload) => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as CastGlobals;
    const cast = w.cast;
    const chrome = w.chrome;
    if (!cast?.framework || !chrome?.cast || !payload.fileId) return;

    const context = cast.framework.CastContext.getInstance();
    try {
      // Ensure a session (prompts the device picker when not connected).
      if (!context.getCurrentSession()) {
        await context.requestSession();
      }
      const session = context.getCurrentSession();
      if (!session) return;

      const url = await mintCastUrl(payload.fileId);
      if (!url) return;

      const mediaInfo = new chrome.cast.media.MediaInfo(url, 'application/x-mpegurl');
      mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
      mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
      if (payload.title) mediaInfo.metadata.title = payload.title;
      if (payload.poster) {
        mediaInfo.metadata.images = [new chrome.cast.Image(payload.poster)];
      }

      const request = new chrome.cast.media.LoadRequest(mediaInfo);
      if (payload.currentTime && Number.isFinite(payload.currentTime)) {
        request.currentTime = Math.max(0, Math.floor(payload.currentTime));
      }
      await session.loadMedia(request);
    } catch {
      // User dismissed the picker, or load failed  nothing to do.
    }
  }, []);

  const stopCast = useCallback(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as CastGlobals;
    const cast = w.cast;
    if (!cast?.framework) return;
    try {
      cast.framework.CastContext.getInstance().endCurrentSession(true);
    } catch {
      // no active session
    }
  }, []);

  return { castAvailable, isCasting, startCast, stopCast };
}
