import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { usePlayerContext } from '../PlayerContext';

export function useHLS(videoRef: React.RefObject<HTMLVideoElement>) {
  const { hlsRef, setState, src } = usePlayerContext();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setState(s => ({ ...s, isLoaded: false, hasError: false, isBuffering: false, isEnded: false }));

    const isHLSStream = src.includes('.m3u8') || src.includes('application/vnd.apple.mpegurl');

    if (isHLSStream && Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 3,
        maxFragLookUpTolerance: 0.25,
        maxBufferHole: 0.5,
        forceKeyFrameOnDiscontinuity: true,
        abrEwmaFastVoD: 3.0,
        abrEwmaSlowVoD: 9.0,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        maxStarvationDelay: 4,
        maxLoadingDelay: 4,
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 10000,
        levelLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        startLevel: -1,
        capLevelToPlayerSize: true,
        testBandwidth: false,
      });

      (hls as any).config.xhrSetup = (xhr: XMLHttpRequest) => {
        try { xhr.withCredentials = true; } catch {}
      };

      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!mountedRef.current) return;
        const lvls = (hls.levels || []).map((l: any) => ({
          height: l.height,
          width: l.width,
          bitrate: l.bitrate,
        }));
        setState(s => ({ ...s, levels: lvls }));

        const pref = safeGet('hls-quality-preference') || 'auto';
        if (pref === 'auto' || lvls.length <= 1) {
          hls.currentLevel = -1;
        } else {
          const want = parseInt(pref, 10);
          let idx = lvls.findIndex(l => l.height === want);
          if (idx === -1) {
            const sorted = lvls.map((l, i) => ({ ...l, i })).sort((a, b) => b.height - a.height);
            const closest = sorted.find(x => x.height <= want) || sorted[sorted.length - 1];
            idx = closest.i;
          }
          hls.currentLevel = idx;
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
        if (mountedRef.current) {
          setState(s => ({ ...s, currentLevel: data.level }));
        }
      });

      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (!mountedRef.current) return;

        if (data.type === 'mediaError' && data.details === 'fragParsingError') {
          if (data.frag?.loader) data.frag.loader.abort();
          hls.startLoad();
          return;
        }

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setState(s => ({ ...s, hasError: true, isLoaded: false, isBuffering: false }));
              break;
          }
        }
      });
    } else if (isHLSStream) {
      setState(s => ({ ...s, hasError: true, levels: [] }));
    } else {
      video.src = src;
      video.load();
      setState(s => ({ ...s, levels: [] }));
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);
}

function safeGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
