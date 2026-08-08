import { useEffect, useRef, type RefObject } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { signedFetch } from '~/lib/Security/requestSigning.client';
import { personalizationService } from '~/lib/Services/PersonalizationService';

/** Spaced heartbeats; server rate limit headroom is generous with one-time playback tokens. */
const HEARTBEAT_MS = 15_000;
const ACCUMULATE_MS = 500;
const MIN_SECONDS_TO_REPORT = 1;
/** Mirrors playback_heat_buckets() in SQL. Changing one without the other invalidates stored curves. */
const HEAT_BUCKETS = 100;

/**
 * Heartbeats while **actually playing** → `/api/views/watch-time` using **chained one-time `playbackToken`**
 * (see `/api/views/watch-issue`). No POSTs while paused/ended or when the tab is hidden.
 */
export function useWatchTimeHeartbeat(videoRef: RefObject<HTMLVideoElement | null>) {
  const { file, authPlaybackFeatures } = usePlayerContext();
  const fileId = file?.id ?? null;

  /** Ref so the effect can read the latest file without re-running on identity changes. */
  const fileRef = useRef(file);
  fileRef.current = file;

  useEffect(() => {
    if (!fileId || !authPlaybackFeatures) return undefined;

    let accumulatedWatchingSeconds = 0;
    let sessionWatchTracked = false;
    /**
     * Most-replayed sampling. Counts which slice of the video the playhead sat
     * in on each accumulator tick, so a rewatched section accrues twice. Sent
     * with the heartbeat that already runs, so this costs no extra requests.
     */
    let heatBuckets = new Map<number, number>();
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

        // Same guard as the accumulator: only count a tick that represents real
        // elapsed playback, so a seek or a backgrounded tab cannot spike one
        // slice. Live streams have no finite duration and get no curve.
        if (Number.isFinite(v.duration) && v.duration > 0 && Number.isFinite(v.currentTime)) {
          const ratio = v.currentTime / v.duration;
          if (ratio >= 0 && ratio < 1) {
            const bucket = Math.min(HEAT_BUCKETS - 1, Math.floor(ratio * HEAT_BUCKETS));
            heatBuckets.set(bucket, (heatBuckets.get(bucket) ?? 0) + 1);
          }
        }
      }

      // Session watch boost: once the user has genuinely watched >50% of
      // this file, steer the in-session feed toward its categories  same
      // signal as an in-session like, but implicit. Fires at most once.
      if (!sessionWatchTracked && Number.isFinite(v.duration) && v.duration > 0) {
        if (accumulatedWatchingSeconds >= v.duration * 0.5) {
          sessionWatchTracked = true;
          const cats = fileRef.current?.categories;
          personalizationService.trackSessionWatch(fileId, Array.isArray(cats) ? cats : null);
        }
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
        // replay in Postman.
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

      // Snapshot and clear up front. If the POST fails these samples are gone
      // rather than replayed onto the next heartbeat, which would double count
      // the slice the viewer happened to be on when the network blipped.
      const heatToSend: number[] = [];
      for (const [bucket, count] of heatBuckets) heatToSend.push(bucket, count);
      heatBuckets = new Map();

      try {
        const res = await fetch('/api/views/watch-time', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playbackToken: tokenToSend,
            watchDurationSeconds: Math.min(86400, Math.round(accumulatedWatchingSeconds)),
            totalDurationSeconds: totalDur,
            ...(heatToSend.length > 0 ? { heat: heatToSend } : {}),
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
