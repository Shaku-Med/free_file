import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';

/**
 * Prevents the device from sleeping while video is playing.
 * Uses the Screen Wake Lock API (supported in Chrome, Edge, Safari 16.4+).
 * Automatically releases on pause/unmount and re-acquires on play/visibility change.
 */
export function useWakeLock(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const { state } = usePlayerContext();
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isPlayingRef = useRef(state.isPlaying);
  isPlayingRef.current = state.isPlaying;

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    const acquire = async () => {
      // Only acquire if video is actually playing and page is visible
      if (!isPlayingRef.current || document.visibilityState !== 'visible') return;
      // Already have an active lock
      if (wakeLockRef.current && !wakeLockRef.current.released) return;

      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch {
        // Wake lock request failed (e.g., low battery mode)
      }
    };

    const release = async () => {
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        try {
          await wakeLockRef.current.release();
        } catch {}
        wakeLockRef.current = null;
      }
    };

    if (state.isPlaying) {
      acquire();
    } else {
      release();
    }

    // Re-acquire when page becomes visible again (wake lock is auto-released on hide)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isPlayingRef.current) {
        acquire();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      release();
    };
  }, [state.isPlaying]);
}
