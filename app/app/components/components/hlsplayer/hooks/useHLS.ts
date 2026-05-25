import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { usePlayerContext } from '../PlayerContext';
import { useFileContext } from '~/lib/Context/Context';
import { isLoadplayPlaybackUrl } from '~/lib/Services/loadplayPlayback.client';

function hlsUsesCredentials(url: string): boolean {
  return !isLoadplayPlaybackUrl(url);
}

function createHlsInstance(forLoadplay: boolean): Hls {
  const appOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const pageUrl =
    typeof document !== 'undefined' ? document.location.href : '';

  const attachLoadplayHeaders = (url: string, headers: Headers) => {
    if (!isLoadplayPlaybackUrl(url)) return;
    if (appOrigin) headers.set('X-App-Origin', appOrigin);
    if (pageUrl) headers.set('X-App-Referer', pageUrl);
  };

  const loadplayRequestInit = (url: string): Pick<RequestInit, 'referrer' | 'referrerPolicy'> => {
    if (!isLoadplayPlaybackUrl(url) || !pageUrl) return {};
    return {
      referrer: pageUrl,
      referrerPolicy: 'strict-origin-when-cross-origin',
    };
  };

  return new Hls({
    enableWorker: !forLoadplay,
    xhrSetup(xhr, url) {
      try {
        xhr.withCredentials = hlsUsesCredentials(url);
        if (isLoadplayPlaybackUrl(url)) {
          if (appOrigin) xhr.setRequestHeader('X-App-Origin', appOrigin);
          if (pageUrl) xhr.setRequestHeader('X-App-Referer', pageUrl);
          if ('referrerPolicy' in xhr) {
            (xhr as XMLHttpRequest & { referrerPolicy: string }).referrerPolicy =
              'strict-origin-when-cross-origin';
          }
        }
      } catch {
        /* ignore */
      }
    },
    fetchSetup(context, initParams) {
      const credentials = hlsUsesCredentials(context.url) ? 'include' : 'omit';
      const headers = new Headers(initParams.headers);
      attachLoadplayHeaders(context.url, headers);
      return new Request(context.url, {
        ...initParams,
        ...loadplayRequestInit(context.url),
        credentials,
        headers,
      });
    },
  });
}

function applyVideoCrossOrigin(video: HTMLVideoElement, playbackSrc: string) {
  if (isLoadplayPlaybackUrl(playbackSrc)) {
    video.crossOrigin = 'anonymous';
  } else {
    video.removeAttribute('crossorigin');
  }
}

export function useHLS(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const { hlsRef, setState, src, autoPlay } = usePlayerContext();
  const { playerSettings } = useFileContext();
  const mountedRef = useRef(true);
  const qualityPrefRef = useRef(playerSettings?.quality ?? 'auto');
  qualityPrefRef.current = playerSettings?.quality ?? 'auto';
  const lastEnginePathRef = useRef<'hlsjs' | 'native' | 'direct' | null>(null);
  const lastAttachedVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastKnownGoodTimeRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      lastEnginePathRef.current = null;
      lastAttachedVideoRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let nativeLoadedCleanup: (() => void) | null = null;
    let timeUpdateCleanup: (() => void) | null = null;

    const isHLSStream =
      src.includes('.m3u8') || src.includes('application/vnd.apple.mpegurl');

    const canNativeHLS =
      isHLSStream && video.canPlayType('application/vnd.apple.mpegurl');

    let cancelled = false;

    const canHotSwapHlsjs =
      isHLSStream &&
      Hls.isSupported() &&
      hlsRef.current !== null &&
      lastEnginePathRef.current === 'hlsjs' &&
      lastAttachedVideoRef.current === video;

    if (canHotSwapHlsjs) {
      const hls = hlsRef.current!;
      const wasPlaying = !video.paused && !video.ended;

      setState((s) => ({
        ...s,
        isLoaded: false,
        hasError: false,
        isBuffering: false,
        isEnded: false,
        levels: [],
        subtitleTracks: [],
      }));

      const resumeAfterSwap = () => {
        if (cancelled || !mountedRef.current) return;
        if (wasPlaying || autoPlay) {
          void video.play().catch(() => {});
        }
      };
      hls.once(Hls.Events.MANIFEST_PARSED, resumeAfterSwap);

      try {
        hls.stopLoad();
        hls.loadSource(src);
        hls.startLoad(-1);
      } catch {
        hls.off(Hls.Events.MANIFEST_PARSED, resumeAfterSwap);
      }

      return () => {
        cancelled = true;
        hls.off(Hls.Events.MANIFEST_PARSED, resumeAfterSwap);
      };
    }

    setState((s) => ({
      ...s,
      isLoaded: false,
      hasError: false,
      isBuffering: false,
      isEnded: false,
    }));

    const run = () => {
      if (cancelled) return;

      if (isHLSStream && Hls.isSupported()) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const hls = createHlsInstance(isLoadplayPlaybackUrl(src));
        hlsRef.current = hls;

        let pendingResumeAt: number | null = null;

        const startLoadResumingVoD = (resumeSeconds: number) => {
          if (!Number.isFinite(resumeSeconds) || resumeSeconds < 0) {
            hls.startLoad(-1);
            pendingResumeAt = null;
            return;
          }
          const d = video.duration;
          if (Number.isFinite(d) && d > 0) {
            if (resumeSeconds >= d - 0.25) {
              const endPos = Math.max(0, d - 0.1);
              pendingResumeAt = endPos;
              hls.startLoad(endPos);
              return;
            }
            const clamped = Math.min(Math.max(0, resumeSeconds), d - 0.05);
            pendingResumeAt = clamped;
            hls.startLoad(clamped);
            return;
          }
          pendingResumeAt = resumeSeconds;
          hls.startLoad(resumeSeconds);
        };

        const applyPendingResume = () => {
          const target = pendingResumeAt;
          if (target === null || !Number.isFinite(target)) return;
          pendingResumeAt = null;
          try {
            const cur = video.currentTime;
            if (Math.abs(cur - target) > 0.5) {
              video.currentTime = target;
            }
          } catch {
            /* ignore */
          }
        };

        hls.loadSource(src);
        applyVideoCrossOrigin(video, src);
        hls.attachMedia(video);
        lastEnginePathRef.current = 'hlsjs';
        lastAttachedVideoRef.current = video;

        const onTimeUpdate = () => {
          const t = video.currentTime;
          if (Number.isFinite(t) && t > 0.1) {
            lastKnownGoodTimeRef.current = t;
          }
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        timeUpdateCleanup?.();
        timeUpdateCleanup = () => {
          video.removeEventListener('timeupdate', onTimeUpdate);
        };

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!mountedRef.current) return;
          applyPendingResume();
          const onceLevel = () => {
            applyPendingResume();
            hls.off(Hls.Events.LEVEL_LOADED, onceLevel);
          };
          hls.on(Hls.Events.LEVEL_LOADED, onceLevel);
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

        hls.on(Hls.Events.ERROR, (_: any, data: any) => {
          if (!mountedRef.current || !data.fatal) return;

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              startLoadResumingVoD(
                Number.isFinite(video.currentTime) && video.currentTime > 0.1
                  ? video.currentTime
                  : lastKnownGoodTimeRef.current,
              );
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
        });
      } else if (isHLSStream && canNativeHLS && !isLoadplayPlaybackUrl(src)) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        video.src = src;
        applyVideoCrossOrigin(video, src);
        video.load();
        lastEnginePathRef.current = 'native';
        lastAttachedVideoRef.current = video;

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
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        video.src = src;
        video.load();
        lastEnginePathRef.current = 'direct';
        lastAttachedVideoRef.current = video;
        setState((s) => ({ ...s, levels: [] }));
      }
    };

    run();

    return () => {
      cancelled = true;
      nativeLoadedCleanup?.();
      timeUpdateCleanup?.();
    };
  }, [src]);
}
