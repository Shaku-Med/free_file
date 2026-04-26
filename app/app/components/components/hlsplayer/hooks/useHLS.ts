import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { usePlayerContext } from '../PlayerContext';
import { useFileContext } from '~/lib/Context/Context';
import {
  exchangeHlsManifestKey,
  stripMkSearchParam,
} from '~/lib/Services/hlsManifestSession.client';

export function useHLS(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const { hlsRef, setState, src } = usePlayerContext();
  const { playerSettings, hlsBootstrap, hlsBootstrapRetry } = useFileContext();
  const mountedRef = useRef(true);
  const postGateSrcRef = useRef<string | null>(null);
  const qualityPrefRef = useRef(playerSettings?.quality ?? 'auto');
  qualityPrefRef.current = playerSettings?.quality ?? 'auto';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    postGateSrcRef.current = null;
    let nativeLoadedCleanup: (() => void) | null = null;

    setState((s) => ({
      ...s,
      isLoaded: false,
      hasError: false,
      isBuffering: false,
      isEnded: false,
    }));

    const isHLSStream =
      src.includes('.m3u8') || src.includes('application/vnd.apple.mpegurl');

    const canNativeHLS =
      isHLSStream && video.canPlayType('application/vnd.apple.mpegurl');

    let cancelled = false;

    const needsManifestExchange =
      isHLSStream &&
      src.includes('/api/load/video/') &&
      !src.includes('_mk=');

    const run = async () => {
      let playbackSrc = src;

      if (needsManifestExchange) {
        const exchanged = await exchangeHlsManifestKey(
          src,
          hlsBootstrap,
          hlsBootstrapRetry
        );
        if (cancelled) return;
        if (!exchanged) {
          setState((s) => ({
            ...s,
            hasError: true,
            isLoaded: false,
            isBuffering: false,
          }));
          return;
        }
        playbackSrc = exchanged;
      }

      if (cancelled) return;

      const fragErrorCounts = new Map<string, number>();
      let manifestReloadCount = 0;
      let lastManifestReloadAt = 0;
      let lastReloadTriggerAt = 0;
      const MAX_FRAG_RETRIES_BEFORE_RELOAD = 3;
      const MAX_MANIFEST_RELOADS_PER_MINUTE = 5;
      const RELOAD_THROTTLE_MS = 1500;

      const reloadSourceUrl = () =>
        postGateSrcRef.current ?? stripMkSearchParam(playbackSrc);

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
          fragLoadingMaxRetry: 12,
          manifestLoadingMaxRetry: 8,
          levelLoadingMaxRetry: 8,
          fragLoadingRetryDelay: 500,
          manifestLoadingRetryDelay: 500,
          levelLoadingRetryDelay: 500,
          fragLoadingMaxRetryTimeout: 4000,
          manifestLoadingMaxRetryTimeout: 4000,
          levelLoadingMaxRetryTimeout: 4000,
          startLevel: -1,
          capLevelToPlayerSize: true,
          testBandwidth: false,
        });

        (hls as any).config.xhrSetup = (xhr: XMLHttpRequest) => {
          try {
            xhr.withCredentials = true;
          } catch {
            /* ignore */
          }
        };

        hlsRef.current = hls;

        const reloadManifestWithFreshTokens = (reason: string) => {
          if (cancelled) return;
          const now = Date.now();
          if (now - lastReloadTriggerAt < RELOAD_THROTTLE_MS) return;
          lastReloadTriggerAt = now;

          if (now - lastManifestReloadAt > 60_000) {
            manifestReloadCount = 0;
          }
          if (manifestReloadCount >= MAX_MANIFEST_RELOADS_PER_MINUTE) {
            setState((s) => ({
              ...s,
              hasError: true,
              isLoaded: false,
              isBuffering: false,
            }));
            return;
          }
          manifestReloadCount++;
          lastManifestReloadAt = now;

          try {
            fragErrorCounts.clear();
            // eslint-disable-next-line no-console
            console.warn('[hls] reloading manifest:', reason);
            hls.stopLoad();
            hls.loadSource(reloadSourceUrl());
            hls.startLoad();
          } catch {
            /* ignore — retries will catch up */
          }
        };

        hls.loadSource(playbackSrc);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!mountedRef.current) return;
          postGateSrcRef.current = stripMkSearchParam(playbackSrc);
          const lvls = (hls.levels || []).map((l: any) => ({
            height: l.height,
            width: l.width,
            bitrate: l.bitrate,
          }));
          setState((s) => ({ ...s, levels: lvls }));

          const pref = qualityPrefRef.current || 'auto';
          if (pref === 'auto' || lvls.length <= 1) {
            hls.currentLevel = -1;
          } else {
            const want = parseInt(pref, 10);
            let idx = lvls.findIndex((l) => l.height === want);
            if (idx === -1) {
              const sorted = lvls
                .map((l, i) => ({ ...l, i }))
                .sort((a, b) => b.height - a.height);
              const closest =
                sorted.find((x) => x.height <= want) || sorted[sorted.length - 1];
              idx = closest.i;
            }
            hls.currentLevel = idx;
          }
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
          if (mountedRef.current) {
            setState((s) => ({ ...s, currentLevel: data.level }));
          }
        });

        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          if (!mountedRef.current) return;
          const tracks = (hls.subtitleTracks || []).map((t: any, i: number) => ({
            id: i,
            label: t.name || t.lang || `Track ${i + 1}`,
            lang: t.lang || '',
            kind: t.type || 'subtitles',
          }));
          setState((s) => ({ ...s, subtitleTracks: tracks }));
        });

        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_: any, data: any) => {
          if (mountedRef.current) {
            setState((s) => ({ ...s, currentSubtitleTrack: data.id ?? -1 }));
          }
        });

        hls.on(Hls.Events.FRAG_LOADED, (_: any, data: any) => {
          const u = data?.frag?.url;
          if (u) fragErrorCounts.delete(u);
        });

        hls.on(Hls.Events.ERROR, (_: any, data: any) => {
          if (!mountedRef.current) return;

          const status: number | undefined = data?.response?.code;
          const details: string = data?.details || '';
          const fragUrl: string | undefined = data?.frag?.url;

          if (status === 401 || status === 403) {
            reloadManifestWithFreshTokens(`auth ${status} on ${details}`);
            return;
          }

          if (status === 429) {
            if (fragUrl && (details === 'fragLoadError' || details === 'fragLoadTimeOut')) {
              fragErrorCounts.delete(fragUrl);
            }
            if (data.fatal) {
              window.setTimeout(() => {
                if (cancelled || !mountedRef.current) return;
                try {
                  hls.startLoad();
                } catch {
                  /* ignore */
                }
              }, 2000);
            }
            return;
          }

          if (data.type === 'mediaError' && details === 'fragParsingError') {
            if (data.frag?.loader) data.frag.loader.abort();
            hls.startLoad();
            return;
          }

          if (fragUrl && (details === 'fragLoadError' || details === 'fragLoadTimeOut')) {
            const n = (fragErrorCounts.get(fragUrl) ?? 0) + 1;
            fragErrorCounts.set(fragUrl, n);
            if (n >= MAX_FRAG_RETRIES_BEFORE_RELOAD) {
              reloadManifestWithFreshTokens(`frag failed ${n}x: ${fragUrl}`);
              return;
            }
          }

          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (
                  details === 'manifestLoadError' ||
                  details === 'manifestLoadTimeOut' ||
                  details === 'levelLoadError' ||
                  details === 'levelLoadTimeOut'
                ) {
                  reloadManifestWithFreshTokens(`fatal ${details}`);
                } else {
                  hls.startLoad();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                try {
                  hls.recoverMediaError();
                } catch {
                  try {
                    hls.swapAudioCodec();
                    hls.recoverMediaError();
                  } catch {
                    setState((s) => ({
                      ...s,
                      hasError: true,
                      isLoaded: false,
                      isBuffering: false,
                    }));
                  }
                }
                break;
              default:
                setState((s) => ({
                  ...s,
                  hasError: true,
                  isLoaded: false,
                  isBuffering: false,
                }));
                break;
            }
          }
        });
      } else if (isHLSStream && canNativeHLS) {
        const isWireless = (video as any).webkitCurrentPlaybackTargetIsWireless;
        let sameSrc = false;
        try {
          const absVideoSrc = video.src
            ? new URL(video.src, location.href).href
            : '';
          const absNewSrc = new URL(playbackSrc, location.href).href;
          sameSrc = absVideoSrc === absNewSrc;
        } catch {
          sameSrc = video.src === playbackSrc;
        }
        if (isWireless && sameSrc) {
          return;
        }
        video.src = playbackSrc;
        video.load();
        postGateSrcRef.current = stripMkSearchParam(playbackSrc);

        const handleLoaded = () => {
          if (!mountedRef.current) return;
          const vTracks = (video as any).videoTracks;
          if (vTracks && vTracks.length >= 1) {
            const lvls = Array.from(vTracks).map((t: any) => ({
              height: Number(t.height) || video.videoHeight || 0,
              width: Number(t.width) || video.videoWidth || 0,
              bitrate: 0,
            }));
            setState((s) => ({ ...s, levels: lvls }));
          } else if (video.videoHeight > 0 || video.videoWidth > 0) {
            setState((s) => ({
              ...s,
              levels: [
                {
                  height: video.videoHeight || 0,
                  width: video.videoWidth || 0,
                  bitrate: 0,
                },
              ],
            }));
          } else {
            setState((s) => ({ ...s, levels: [] }));
          }
        };
        video.addEventListener('loadedmetadata', handleLoaded);
        nativeLoadedCleanup = () => {
          video.removeEventListener('loadedmetadata', handleLoaded);
        };
      } else if (isHLSStream) {
        setState((s) => ({ ...s, hasError: true, levels: [] }));
      } else {
        video.src = src;
        video.load();
        setState((s) => ({ ...s, levels: [] }));
      }
    };

    void run();

    return () => {
      cancelled = true;
      nativeLoadedCleanup?.();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    // videoRef is a stable ref object; hlsRef/setState are stable enough for playback setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-resolve when src or bootstrap blobs change
  }, [src, hlsBootstrap, hlsBootstrapRetry]);
}
