import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { usePlayerContext } from '../PlayerContext';
import { useFileContext } from '~/lib/Context/Context';
import {
  exchangeHlsManifestKey,
  invalidateManifestKeyCache,
  stripMkSearchParam,
} from '~/lib/Services/hlsManifestSession.client';

export function useHLS(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const { hlsRef, setState, src, autoPlay } = usePlayerContext();
  const { playerSettings, hlsBootstrap, hlsBootstrapRetry } = useFileContext();
  const hlsAuthRef = useRef({ hlsBootstrap, hlsBootstrapRetry });
  hlsAuthRef.current = { hlsBootstrap, hlsBootstrapRetry };
  const mountedRef = useRef(true);
  const qualityPrefRef = useRef(playerSettings?.quality ?? 'auto');
  qualityPrefRef.current = playerSettings?.quality ?? 'auto';
  /** Tracks which engine path serviced the previous src so we can decide whether to hot-swap. */
  const lastEnginePathRef = useRef<'hlsjs' | 'native' | 'direct' | null>(null);
  const lastAttachedVideoRef = useRef<HTMLVideoElement | null>(null);
  /** Most-recent non-zero playback position. Sampled on timeupdate so a
   *  brief `currentTime === 0` reading during an error path doesn't
   *  cause the resume logic to restart the video from the beginning. */
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

    const needsManifestExchange =
      isHLSStream &&
      src.includes('/api/load/video/') &&
      !src.includes('_mk=');

    /** Same stream via our API: can mint a new master URL so playlists get fresh `_st` without resetting the player instance. */
    const canRemintPlaylist =
      isHLSStream && src.includes('/api/load/video/');

    /**
     * Hot-swap path: same Hls.js engine + same video element + new HLS source. Calling
     * `loadSource` on the existing instance keeps `<video>` attached, preserves event
     * listeners (MANIFEST_PARSED, LEVEL_SWITCHED, SUBTITLE_TRACKS_UPDATED, ERROR — all
     * re-fire for the new manifest), and avoids the brief detach that breaks autoplay.
     */
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
        // Auto-next / navigation swaps often occur after `ended` → `wasPlaying` is false,
        // but the caller still expects the new src to start immediately when autoPlay is on.
        if (wasPlaying || autoPlay) {
          void video.play().catch(() => {});
        }
      };
      hls.once(Hls.Events.MANIFEST_PARSED, resumeAfterSwap);

      void (async () => {
        let playbackSrc = src;
        if (needsManifestExchange) {
          const { hlsBootstrap: boot, hlsBootstrapRetry: retry } = hlsAuthRef.current;
          const exchanged = await exchangeHlsManifestKey(src, boot, retry);
          if (cancelled || !mountedRef.current) return;
          if (!exchanged) {
            hls.off(Hls.Events.MANIFEST_PARSED, resumeAfterSwap);
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
        if (cancelled || !mountedRef.current) {
          hls.off(Hls.Events.MANIFEST_PARSED, resumeAfterSwap);
          return;
        }
        try {
          hls.stopLoad();
          hls.loadSource(playbackSrc);
          hls.startLoad(-1);
        } catch {
          hls.off(Hls.Events.MANIFEST_PARSED, resumeAfterSwap);
        }
      })();

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

        // Pending resume target. Set when we trigger a remint / network
        // recovery. The next MANIFEST_PARSED handler reads this and
        // forces the <video> element back to that position, because
        // hls.js's `startLoad(seekPosition)` is best-effort — depending
        // on timing it can leave the playhead at 0 after a loadSource,
        // which is exactly the "boom it starts from the beginning" the
        // user was hitting.
        let pendingResumeAt: number | null = null;

        const startLoadResumingVoD = (resumeSeconds: number) => {
          if (!Number.isFinite(resumeSeconds) || resumeSeconds < 0) {
            hls.startLoad(-1);
            pendingResumeAt = null;
            return;
          }
          const d = video.duration;
          if (Number.isFinite(d) && d > 0) {
            // Past-the-end: don't restart from zero — pin to the last
            // frame so the player just shows the ended state, matching
            // what the user was seeing before the token died.
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

        // Defensive resume: if pendingResumeAt is set when the next
        // manifest finishes parsing, re-seek the <video> if it's drifted
        // off target. Cheaper than fighting hls.js's start-position
        // semantics and works across loadSource boundaries.
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
            /* readyState may be too early — ignore, next event will retry */
          }
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

          // Resume target: prefer the live playhead, but fall back to
          // the most-recent non-zero position we've seen. video.currentTime
          // can momentarily read 0 mid-error (Safari especially), and if
          // we capture 0 here the user gets the dreaded restart-from-start.
          const live = video.currentTime;
          const resumeAt =
            Number.isFinite(live) && live > 0.1
              ? live
              : lastKnownGoodTimeRef.current ?? 0;
          const baseSrc = stripMkSearchParam(src);
          // A 403 here almost always means the cached `_mk` was already consumed at the
          // CDN (e.g., by an earlier mount of the same player). Drop the cache entry so
          // we mint a fresh token instead of replaying the dead one.
          invalidateManifestKeyCache(baseSrc);
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
        lastEnginePathRef.current = 'hlsjs';
        lastAttachedVideoRef.current = video;

        // Sample the last known good playhead. The remint / recovery
        // path falls back to this when video.currentTime momentarily
        // reads 0 mid-error (Safari quirk most often), preventing the
        // "boom it restarts" symptom.
        const onTimeUpdate = () => {
          const t = video.currentTime;
          if (Number.isFinite(t) && t > 0.1) {
            lastKnownGoodTimeRef.current = t;
          }
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        // Replace any prior listener registration so src-change re-runs
        // don't accumulate listeners on the persistent video element.
        timeUpdateCleanup?.();
        timeUpdateCleanup = () => {
          video.removeEventListener('timeupdate', onTimeUpdate);
        };

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!mountedRef.current) return;
          // Re-seek if a remint / recovery captured a position we still
          // owe. Runs before level selection so the playhead is correct
          // by the time hls picks the next fragment.
          applyPendingResume();
          // Belt + suspenders: video metadata may not be loaded yet on
          // first MANIFEST_PARSED — wait once more after LEVEL_LOADED to
          // finish the seek if the first attempt no-op'd.
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
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
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

    void run();

    return () => {
      cancelled = true;
      nativeLoadedCleanup?.();
      timeUpdateCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap via hlsAuthRef only; new tokens on root revalidate must not restart HLS
  }, [src]);
}
