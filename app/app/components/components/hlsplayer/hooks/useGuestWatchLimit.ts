import { useEffect, useRef, useCallback, useState } from "react";

/** Seconds before the cap when we show the “sign in for full video” nudge. */
function nudgeLeadSeconds(limitSeconds: number): number {
  if (limitSeconds <= 45) return Math.max(8, Math.floor(limitSeconds * 0.35));
  return Math.min(30, Math.max(15, Math.floor(limitSeconds * 0.12)));
}

/**
 * Enforces a max watch position for signed-out preview (backup to server-truncated HLS).
 */
export function useGuestWatchLimit(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  limitSeconds: number | null | undefined,
  enabled: boolean
) {
  const [wallOpen, setWallOpen] = useState(false);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const hitRef = useRef(false);
  const nudgeDismissedRef = useRef(false);

  useEffect(() => {
    hitRef.current = false;
    nudgeDismissedRef.current = false;
    setWallOpen(false);
    setNudgeVisible(false);
    setSecondsRemaining(0);
  }, [limitSeconds, enabled]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled || limitSeconds == null || limitSeconds <= 0) return;

    const lim = limitSeconds;
    const lead = nudgeLeadSeconds(lim);

    /**
     * Wall-clock seconds left, not content seconds. At 1.5x the cap arrives a
     * third sooner, and the old maths quoted the content figure — so the number
     * on screen was simply wrong whenever the viewer changed speed.
     */
    const realSecondsLeft = () => {
      const rate = video.playbackRate > 0 ? video.playbackRate : 1;
      return (lim - video.currentTime) / rate;
    };

    const onTime = () => {
      const remaining = realSecondsLeft();
      setSecondsRemaining(remaining);

      if (
        remaining > 0 &&
        remaining <= lead &&
        !nudgeDismissedRef.current &&
        !hitRef.current
      ) {
        setNudgeVisible(true);
      } else if (remaining <= 0 || remaining > lead) {
        setNudgeVisible(false);
      }

      if (video.currentTime >= lim) {
        video.currentTime = lim;
        if (!video.paused) video.pause();
        if (!hitRef.current) {
          hitRef.current = true;
          setWallOpen(true);
        }
        setNudgeVisible(false);
      }
    };

    const onSeek = () => {
      if (video.currentTime > lim) {
        video.currentTime = lim;
        video.pause();
        setWallOpen(true);
      }
      const remaining = realSecondsLeft();
      setSecondsRemaining(remaining);
      if (remaining > lead || remaining <= 0) {
        setNudgeVisible(false);
      } else if (!nudgeDismissedRef.current && !hitRef.current) {
        setNudgeVisible(true);
      }
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeking", onSeek);
    video.addEventListener("seeked", onSeek);
    video.addEventListener("ratechange", onTime);
    // timeupdate is throttled hard in background tabs while playback carries on,
    // which left the figure stale and drifting. A ticker keeps it honest.
    const ticker = window.setInterval(() => {
      if (!video.paused && !video.ended) onTime();
    }, 500);
    return () => {
      window.clearInterval(ticker);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeking", onSeek);
      video.removeEventListener("seeked", onSeek);
      video.removeEventListener("ratechange", onTime);
    };
  }, [videoRef, enabled, limitSeconds]);

  const dismissWall = useCallback(() => setWallOpen(false), []);

  const dismissNudge = useCallback(() => {
    nudgeDismissedRef.current = true;
    setNudgeVisible(false);
  }, []);

  return {
    wallOpen,
    dismissWall,
    setWallOpen,
    nudgeVisible,
    secondsRemaining,
    dismissNudge,
  };
}
