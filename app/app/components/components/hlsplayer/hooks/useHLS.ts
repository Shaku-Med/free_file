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
  const hlsAuthRef = useRef({ hlsBootstrap, hlsBootstrapRetry });
  hlsAuthRef.current = { hlsBootstrap, hlsBootstrapRetry };
  const mountedRef = useRef(true);
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

    /** Same stream via our API: can mint a new master URL so playlists get fresh `_st` without resetting the player instance. */
    const canRemintPlaylist =
      isHLSStream && src.includes('/api/load/video/');

    const run = async () => {
      let playbackSrc = src;

      if (needsManifestExchange) {
        const { hlsBootstrap: boot, hlsBootstrapRetry: retry } = hlsAuthRef.current;
        const exchanged = await exchangeHlsManifestKey(src, boot, retry);
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

      if (isHLSStream && Hls.isSupported()) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const hls = new Hls({
          enableWorker: true,
          xhrSetup(xhr) {
            try {
              xhr.withCredentials = true;
            } catch {
              /* ignore */
            }
          },
        });

        hlsRef.current = hls;

        const startLoadResumingVoD = (resumeSeconds: number) => {
          if (!Number.isFinite(resumeSeconds) || resumeSeconds < 0) {
            hls.startLoad(-1);
            return;
          }
          const d = video.duration;
          if (Number.isFinite(d) && d > 0) {
            if (resumeSeconds >= d - 0.25) {
              hls.startLoad(-1);
              return;
            }
            hls.startLoad(Math.min(Math.max(0, resumeSeconds), d - 0.05));
            return;
          }
          hls.startLoad(resumeSeconds);
        };

        let playlistRemintInFlight = false;
        let remintCountWindowStart = 0;
        let remintCountInWindow = 0;
        let lastRemintAt = 0;
        const REMINT_THROTTLE_MS = 2000;
        const REMINT_MAX_PER_WINDOW = 10;
        const REMINT_WINDOW_MS = 300_000;

        const remintPlaylistAndResume = async (_reason: string) => {
          if (cancelled || !mountedRef.current || !canRemintPlaylist) return;
          const now = Date.now();
          if (now - remintCountWindowStart > REMINT_WINDOW_MS) {
            remintCountWindowStart = now;
            remintCountInWindow = 0;
          }
          if (remintCountInWindow >= REMINT_MAX_PER_WINDOW) {
            setState((s) => ({
              ...s,
              hasError: true,
              isLoaded: false,
              isBuffering: false,
            }));
            return;
          }
          if (playlistRemintInFlight || now - lastRemintAt < REMINT_THROTTLE_MS) return;

          playlistRemintInFlight = true;
          lastRemintAt = now;
          remintCountInWindow += 1;

          const resumeAt = video.currentTime;
          const baseSrc = stripMkSearchParam(src);
          const { hlsBootstrap: boot, hlsBootstrapRetry: retry } = hlsAuthRef.current;
          const newUrl = await exchangeHlsManifestKey(baseSrc, boot, retry);

          playlistRemintInFlight = false;
          if (cancelled || !mountedRef.current) return;

          if (!newUrl) {
            startLoadResumingVoD(resumeAt);
            return;
          }

          try {
            hls.stopLoad();
            hls.loadSource(newUrl);
            startLoadResumingVoD(resumeAt);
          } catch {
            startLoadResumingVoD(resumeAt);
          }
        };

        hls.loadSource(playbackSrc);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!mountedRef.current) return;
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
          if (!mountedRef.current) return;

          const status: number | undefined = data?.response?.code;
          const details: string = data?.details || '';

          if (status === 403 && canRemintPlaylist) {
            void remintPlaylistAndResume(details);
            return;
          }

          if (!data.fatal) return;

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              startLoadResumingVoD(video.currentTime);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap via hlsAuthRef only; new tokens on root revalidate must not restart HLS
  }, [src]);
}
