import { useEffect, type RefObject } from 'react';
import { usePlayerContext } from '../PlayerContext';

/** Spaced heartbeats; server rate limit headroom is generous with one-time playback tokens. */
const HEARTBEAT_MS = 15_000;
const ACCUMULATE_MS = 500;
const MIN_SECONDS_TO_REPORT = 1;

/**
 * Heartbeats while **actually playing** → `/api/views/watch-time` using **chained one-time `playbackToken`**
 * (see `/api/views/watch-issue`). No POSTs while paused/ended or when the tab is hidden.
 */
export function useWatchTimeHeartbeat(videoRef: RefObject<HTMLVideoElement | null>) {
  const { file, authPlaybackFeatures } = usePlayerContext();
  const fileId = file?.id ?? null;

  useEffect(() => {
    if (!fileId || !authPlaybackFeatures) return undefined;

    let accumulatedWatchingSeconds = 0;
    let lastSampleWallMs = performance.now();
    let playbackToken: string | null = null;
    let tokenFetchInFlight = false;
    /** Serializes POSTs so tokens are never double-consumed across overlapping heartbeats. */
    let sendChain: Promise<void> = Promise.resolve();

    let accumulateTimer: number | null = null;
    let postTimer: number | null = null;
    let video: HTMLVideoElement | null = null;
    let refPoll: number | null = null;
    let disposed = false;

    const bumpAccumulator = () => {
      const v = videoRef.current;
      if (!v || v.paused || v.ended || document.visibilityState !== 'visible') {
        lastSampleWallMs = performance.now();
        return;
      }
      const now = performance.now();
      const deltaSec = (now - lastSampleWallMs) / 1000;
      lastSampleWallMs = now;
      if (deltaSec > 0 && deltaSec < ACCUMULATE_MS / 1000 + 2) {
        accumulatedWatchingSeconds += deltaSec;
      }
    };

    const canSendNow = () => {
      const v = videoRef.current;
      if (!v || v.paused || v.ended || document.visibilityState !== 'visible') return false;
      return true;
    };

    const bootstrapToken = async (): Promise<boolean> => {
      if (playbackToken || tokenFetchInFlight || disposed) return Boolean(playbackToken);
      tokenFetchInFlight = true;
      try {
        // signedFetch attaches X-Sig + X-Sig-Ts so the server-side guard
        // can confirm this request came from our JS, not a stolen-cookie
        // replay in Postman. Lazy import keeps the security module out of
        // the SSR bundle.
        const { signedFetch } = await import('~/lib/Security/requestSigning.client');
        const res = await signedFetch(
          `/api/views/watch-issue?${new URLSearchParams({ fileId })}`,
          { credentials: 'include' },
        );
        if (!res.ok) return false;
        const data = (await res.json()) as { playbackToken?: string };
        if (typeof data.playbackToken === 'string' && data.playbackToken.trim() !== '') {
          playbackToken = data.playbackToken.trim();
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        tokenFetchInFlight = false;
      }
    };

    const sendOnce = async () => {
      if (disposed || !canSendNow()) return;

      bumpAccumulator();
      if (accumulatedWatchingSeconds < MIN_SECONDS_TO_REPORT) return;

      if (!playbackToken) {
        const ok = await bootstrapToken();
        if (!ok || !playbackToken) return;
      }

      const v = videoRef.current;
      const totalDur =
        v && Number.isFinite(v.duration) && v.duration > 0 ? Math.min(86400, v.duration) : 0;

      const tokenToSend = playbackToken;
      if (!tokenToSend) return;

      try {
        const res = await fetch('/api/views/watch-time', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playbackToken: tokenToSend,
            watchDurationSeconds: Math.min(86400, Math.round(accumulatedWatchingSeconds)),
            totalDurationSeconds: totalDur,
          }),
        });

        if (res.ok) {
          try {
            const data = (await res.json()) as { nextPlaybackToken?: string };
            if (typeof data.nextPlaybackToken === 'string' && data.nextPlaybackToken.trim() !== '') {
              playbackToken = data.nextPlaybackToken.trim();
            } else {
              playbackToken = null;
            }
          } catch {
            playbackToken = null;
          }
          return;
        }

        if (res.status === 409 || res.status === 403 || res.status === 400) {
          playbackToken = null;
          void bootstrapToken();
        }
      } catch {
        playbackToken = null;
      }
    };

    const enqueueSend = () => {
      sendChain = sendChain
        .then(() => sendOnce())
        .catch(() => {});
    };

    const onPlayWarmToken = () => {
      lastSampleWallMs = performance.now();
      void bootstrapToken();
    };

    const onPauseEnded = () => {
      lastSampleWallMs = performance.now();
      /** Discard client-side chain after pause  next play re-mints fresh session via bootstrap. */
      playbackToken = null;
    };

    const attachVideo = (): boolean => {
      const v = videoRef.current;
      if (!v) return false;
      if (v !== video) {
        if (video) {
          video.removeEventListener('play', onPlayWarmToken);
          video.removeEventListener('pause', onPauseEnded);
          video.removeEventListener('ended', onPauseEnded);
        }
        video = v;
        video.addEventListener('play', onPlayWarmToken);
        video.addEventListener('pause', onPauseEnded);
        video.addEventListener('ended', onPauseEnded);
        lastSampleWallMs = performance.now();
        if (!video.paused && !video.ended) void bootstrapToken();
      }
      return true;
    };

    if (!attachVideo()) {
      refPoll = window.setInterval(() => {
        if (attachVideo() && video != null && refPoll != null) {
          clearInterval(refPoll);
          refPoll = null;
        }
      }, 200);
    }

    const onVisibilityChange = () => {
      lastSampleWallMs = performance.now();
      if (document.visibilityState !== 'visible') {
        playbackToken = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    accumulateTimer = window.setInterval(bumpAccumulator, ACCUMULATE_MS);
    postTimer = window.setInterval(enqueueSend, HEARTBEAT_MS);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (refPoll != null) {
        clearInterval(refPoll);
        refPoll = null;
      }
      if (video) {
        video.removeEventListener('play', onPlayWarmToken);
        video.removeEventListener('pause', onPauseEnded);
        video.removeEventListener('ended', onPauseEnded);
      }
      if (accumulateTimer != null) clearInterval(accumulateTimer);
      if (postTimer != null) clearInterval(postTimer);
      void sendChain;

      /** No network flush on teardown  aligns with \"no POST when not playing\". */
      playbackToken = null;
    };
  }, [fileId, authPlaybackFeatures]);
}
