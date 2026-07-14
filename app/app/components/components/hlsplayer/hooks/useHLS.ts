import { useCallback, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { usePlayerContext } from '../PlayerContext';
import { useFileContext } from '~/lib/Context/Context';
import { isLoadplayPlaybackUrl } from '~/lib/Services/loadplayPlayback.client';
import { requestPlaybackUrlRefresh, playbackAssetPath } from '~/lib/playbackUrlCache';

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

/** Max re-mint attempts on repeated fatal network errors before giving up and
 *  showing the user a failure (instead of looping mint→fetch→fail forever). */
const MAX_MANIFEST_REMINTS = 4;

export function useHLS(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const { hlsRef, setState, src, autoPlay, file, isReel, startTime } = usePlayerContext();
  const { playerSettings } = useFileContext();
  const mountedRef = useRef(true);
  // Reels always stream at adaptive `auto`  short, vertical, fast-scrolled
  // clips shouldn't inherit the user's global quality pick (e.g. a forced
  // 1080p that stalls on mobile). Non-reel players keep the saved preference.
  const resolveQualityPref = () => (isReel ? 'auto' : playerSettings?.quality ?? 'auto');
  const qualityPrefRef = useRef(resolveQualityPref());
  qualityPrefRef.current = resolveQualityPref();
  const lastEnginePathRef = useRef<'hlsjs' | 'native' | 'direct' | null>(null);
  const lastAttachedVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastKnownGoodTimeRef = useRef<number>(0);
  // Cap re-mint attempts on repeated fatal network errors so a permanently
  // failing manifest doesn't loop mint -> fetch -> fail -> mint forever. Reset
  // on a successful manifest parse (a real recovery earns fresh attempts).
  const remintAttemptsRef = useRef(0);
  const lastRemintAtRef = useRef(0);

  /** Manual retry from the error overlay: clear the failure, reset the re-mint
   *  budget, and force a fresh manifest load. */
  const retryPlayback = useCallback(() => {
    remintAttemptsRef.current = 0;
    lastRemintAtRef.current = 0;
    setState((s) => ({ ...s, hasError: false, isLoaded: false, isBuffering: true }));
    const fileId = file?.unique_id;
    if (fileId && typeof src === 'string' && isLoadplayPlaybackUrl(src)) {
      requestPlaybackUrlRefresh(fileId);
    } else if (hlsRef.current) {
      try {
        hlsRef.current.startLoad();
      } catch {
        /* ignore */
      }
    }
  }, [setState, file, src, hlsRef]);
  // Tracks the previous src path (no ?t=) so we can detect a token only
  // refresh vs a true video change and preserve currentTime in the former.
  const lastSrcPathRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const hls = hlsRef.current;
      // Capture the element BEFORE nulling refs so we can free its decoder even
      // if React has already detached `videoRef`.
      const video = lastAttachedVideoRef.current ?? videoRef.current;
      hlsRef.current = null;
      lastEnginePathRef.current = null;
      lastAttachedVideoRef.current = null;

      // CHEAP, synchronous: stop hls.js loaders + detach media so the decoder
      // stops immediately (the expensive destroy is deferred below).
      if (hls) {
        try {
          hls.stopLoad();
        } catch {
          /* instance already half-torn-down */
        }
        try {
          hls.detachMedia();
        } catch {
          /* no media attached */
        }
      }

      // Release the native media decoder NOW. On iOS, reels play via native HLS
      // (so `hls` is null and the old code returned here, leaking), and the
      // hardware decoder pool is tiny (~3-4). A `<video>` left with `src`
      // attached after its slide unmounts keeps holding a decoder, so after a
      // few swipes new reels can't get one and Safari crashes the tab.
      // Detaching src + load() forces the decoder + buffers to free at once.
      if (video) {
        try {
          video.pause();
          video.removeAttribute('src');
          while (video.firstChild) video.removeChild(video.firstChild);
          video.load();
        } catch {
          /* element already gone */
        }
      }

      if (!hls) return;

      // Navigation away tears down the player. `hls.destroy()` is heavy
      // (aborts loaders, removes SourceBuffers, rips down ABR + listeners) and
      // ran synchronously here  blocking the new route's first paint, which
      // is the "player holds back the navigation" lag. Defer the expensive
      // teardown until AFTER the navigation has painted (media is already
      // detached above, so nothing keeps decoding in the meantime).
      const finishDestroy = () => {
        try {
          hls.destroy();
        } catch {
          /* already destroyed */
        }
      };
      // requestIdleCallback runs after paint when the main thread is free;
      // the timeout caps the wait, and setTimeout(0) covers Safari.
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(finishDestroy, { timeout: 500 });
      } else {
        setTimeout(finishDestroy, 0);
      }
    };
  }, []);

  // Visibility-resume recovery. ONLY runs when the page comes back and the
  // player is actually in a broken state (real video error, or hls.js error
  // flag set). We do NOT proactively re-mint just because the tab was hidden
  //  the HLS error handler already re-mints reactively when a segment 401s,
  // and a proactive refresh during a happy paused-then-resumed session is
  // annoying (hot swap reloads the manifest + can revive autoplay).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.hidden) return;
      const fileId = file?.unique_id;
      if (!fileId) return;
      const video = videoRef.current;
      const inError =
        Boolean(video?.error) ||
        // networkState=3 (NETWORK_NO_SOURCE) shows up after a failed fetch.
        (video ? (video as HTMLVideoElement).networkState === 3 : false);
      if (!inError) return;
      setState((s) => ({ ...s, hasError: false }));
      requestPlaybackUrlRefresh(fileId);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [file?.unique_id, setState, videoRef]);

  // Stall watchdog. During long mobile playback the buffer can drain when
  // the radio drops (tower handoff, elevator, weak signal). hls.js retries
  // the fragment a few times, then either goes fatal or just idles in its
  // backoff window  if the connection comes back AFTER retries exhausted,
  // nothing wakes the player and the spinner stays forever until the user
  // refreshes the page. This watchdog covers the gap:
  //   t+12s stalled → hls.startLoad(currentTime)  fresh fragment fetches,
  //                    resets retry state. This is hls.js's documented
  //                    network-error recovery path.
  //   t+25s stalled → re-mint the playback URL (for LoadPlay), same code
  //                    path the visibility-recovery and fatal-error handlers
  //                    already use.
  //   window 'online' → kick immediately instead of waiting for the timer.
  // Any 'playing'/'canplay' event clears the timers, so a slow-but-healthy
  // buffer fill never trips it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const video = videoRef.current;
    if (!video) return;

    const KICK_MS = 12_000;
    const REFRESH_MS = 25_000;
    let kickTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (kickTimer !== null) {
        clearTimeout(kickTimer);
        kickTimer = null;
      }
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    // "Stalled" = user wants playback, but media isn't progressing. We don't
    // intervene when the user has deliberately paused.
    const stillStalled = () =>
      !video.paused && !video.ended && video.readyState < 3;

    const kickHls = () => {
      const hls = hlsRef.current;
      if (!hls) return;
      const at =
        Number.isFinite(video.currentTime) && video.currentTime > 0.1
          ? video.currentTime
          : lastKnownGoodTimeRef.current;
      try {
        hls.startLoad(at);
      } catch {
        /* hls instance may already be destroyed  ignore */
      }
    };

    const triggerRemint = () => {
      const fileId = file?.unique_id;
      if (!fileId) return;
      if (typeof src !== 'string' || !isLoadplayPlaybackUrl(src)) {
        // Non-LoadPlay direct URL: a second startLoad kick is the best
        // recovery available without changing the src.
        kickHls();
        return;
      }
      requestPlaybackUrlRefresh(fileId);
    };

    const armWatchdog = () => {
      clearTimers();
      if (!stillStalled()) return;
      kickTimer = setTimeout(() => {
        kickTimer = null;
        if (!stillStalled()) return;
        kickHls();
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          if (!stillStalled()) return;
          triggerRemint();
        }, REFRESH_MS - KICK_MS);
      }, KICK_MS);
    };

    const onWaiting = () => armWatchdog();
    const onStalled = () => armWatchdog();
    const onPlaying = () => clearTimers();
    const onCanPlay = () => clearTimers();
    const onPause = () => clearTimers();
    const onEnded = () => clearTimers();
    const onSeeked = () => clearTimers();

    const onOnline = () => {
      // Network restored. If we're still spinning, recover immediately
      // instead of waiting up to 12 more seconds for the watchdog tick.
      if (!stillStalled()) return;
      clearTimers();
      kickHls();
      // Belt-and-suspenders: if the kick alone doesn't recover within the
      // refresh window, fall back to a fresh mint.
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (!stillStalled()) return;
        triggerRemint();
      }, REFRESH_MS - KICK_MS);
    };

    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('seeked', onSeeked);
    window.addEventListener('online', onOnline);

    // If we mount mid-stall (e.g. handoff from mini-player while buffering)
    // arm the watchdog immediately so we don't sit here forever.
    if (stillStalled()) armWatchdog();

    return () => {
      clearTimers();
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('seeked', onSeeked);
      window.removeEventListener('online', onOnline);
    };
  }, [src, file?.unique_id, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Watch→watch: mint clears src briefly  pause so the previous manifest
    // doesn't keep playing under the new page's metadata.
    if (!src) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      return;
    }

    let nativeLoadedCleanup: (() => void) | null = null;
    let timeUpdateCleanup: (() => void) | null = null;

    // Single source of truth for picking the active level from the user's
    // preference. Called after every manifest parse (initial AND hot swap)
    // so the chosen quality survives token refreshes.
    const applyQualityPref = (
      hls: Hls,
      lvls: { height: number }[],
    ) => {
      const pref = qualityPrefRef.current || 'auto';
      if (pref === 'auto' || lvls.length <= 1) {
        hls.currentLevel = -1;
        return;
      }
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
    };

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
      // Distinguish a token only refresh (same /v/<fileId>/... path, new
      // ?t=) from a true video change. On token refresh we resume at the
      // last good currentTime so the user doesn't see a jump back to 0.
      const newPath = playbackAssetPath(src);
      const sameAsset =
        Boolean(newPath) && lastSrcPathRef.current === newPath;
      lastSrcPathRef.current = newPath;

      // Snapshot the user's intent at the moment of the swap. We DON'T treat
      // "ended" as "was playing"  the original code did, which made paused-
      // at-end states resume on every token refresh. And we keep this strict
      // (no autoPlay override) on same-asset swaps so a paused user stays
      // paused after a refresh.
      const wasPlaying = !video.paused && !video.ended;
      const resumeAt =
        sameAsset && Number.isFinite(video.currentTime) && video.currentTime > 0.1
          ? video.currentTime
          : sameAsset
            ? lastKnownGoodTimeRef.current
            : 0;

      setState((s) => ({
        ...s,
        isLoaded: false,
        hasError: false,
        isBuffering: false,
        isEnded: !sameAsset ? false : s.isEnded,
        levels: [],
        subtitleTracks: [],
      }));

      try {
        video.pause();
        if (!sameAsset && Number.isFinite(video.duration) && video.duration > 0) {
          // True video change: clear ended + reset to 0.
          video.currentTime = 0;
        }
      } catch {
        /* some browsers throw if duration isn't ready yet */
      }

      const resumeAfterSwap = () => {
        if (cancelled || !mountedRef.current) return;
        // Reapply the user's quality preference  hls.js resets the active
        // level on a fresh manifest parse, so without this the player would
        // silently drop back to auto after a token refresh / hot swap.
        const newLvls = (hls.levels || []).map((l: any) => ({
          height: l.height,
          width: l.width,
          bitrate: l.bitrate,
        }));
        setState((s) => ({ ...s, levels: newLvls }));
        applyQualityPref(hls, newLvls);
        if (sameAsset && resumeAt > 0.1) {
          try {
            video.currentTime = resumeAt;
          } catch {
            /* ignore */
          }
        } else if (!sameAsset) {
          try {
            if (video.currentTime > 0.5) video.currentTime = 0;
          } catch {
            /* ignore */
          }
        }
        // Same-asset hot swap (token refresh): respect the user's pause state
        // strictly  no autoPlay override. If they paused before the swap,
        // they stay paused after. For a true video change (different asset)
        // we still honor autoPlay so the next file starts on its own.
        const shouldResume = sameAsset ? wasPlaying : wasPlaying || autoPlay;
        if (shouldResume) {
          void video.play().catch(() => {});
        }
      };
      hls.once(Hls.Events.MANIFEST_PARSED, resumeAfterSwap);

      try {
        hls.stopLoad();
        hls.loadSource(src);
        hls.startLoad(sameAsset ? resumeAt : -1);
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
        lastSrcPathRef.current = playbackAssetPath(src);

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
          // Manifest loaded fine  the player recovered, so clear the re-mint
          // budget. A later transient error gets a fresh set of attempts.
          remintAttemptsRef.current = 0;
          applyPendingResume();
          // PiP / watch handoff: jump to the opener's position instead of restarting at 0.
          if (typeof startTime === 'number' && startTime > 0.1) {
            startLoadResumingVoD(startTime);
            applyPendingResume();
          }
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
          applyQualityPref(hls, lvls);
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
            case Hls.ErrorTypes.NETWORK_ERROR: {
              // For LoadPlay URLs we always re-mint on a fatal network error,
              // not just 401/403. After a long mobile background the token can
              // expire, the fingerprint can drift on a network switch, or the
              // fetch itself can fail (code 0) while the WiFi reconnects. A
              // fresh mint hot-swaps onto a working URL and the user never sees
              // a failure. Mint refresh is debounced upstream, so multiple
              // fatal errors collapse into one re-mint.
              const isLoadplayUrl =
                typeof src === 'string' && isLoadplayPlaybackUrl(src);
              if (isLoadplayUrl && file?.unique_id) {
                const now = Date.now();
                // Fresh problem (gap since the last failure) → fresh budget,
                // so a long-later hiccup isn't penalised by old attempts.
                if (now - lastRemintAtRef.current > 30_000) remintAttemptsRef.current = 0;
                lastRemintAtRef.current = now;
                if (remintAttemptsRef.current >= MAX_MANIFEST_REMINTS) {
                  // Stop the mint→fetch→fail loop and tell the user it failed.
                  setState((s) => ({ ...s, hasError: true, isLoaded: false, isBuffering: false }));
                  break;
                }
                remintAttemptsRef.current += 1;
                requestPlaybackUrlRefresh(file.unique_id);
                break;
              }
              startLoadResumingVoD(
                Number.isFinite(video.currentTime) && video.currentTime > 0.1
                  ? video.currentTime
                  : lastKnownGoodTimeRef.current,
              );
              break;
            }
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
          if (typeof startTime === 'number' && startTime > 0.1) {
            try {
              const d = video.duration;
              const target =
                Number.isFinite(d) && d > 0 ? Math.min(startTime, Math.max(0, d - 0.25)) : startTime;
              video.currentTime = target;
            } catch {
              /* ignore */
            }
          }
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

  return { retryPlayback };
}
