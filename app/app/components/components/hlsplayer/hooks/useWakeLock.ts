import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { markSystemInterrupt } from '~/lib/playback/backgroundPlayback';

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
  // Set only around a release() we initiated. A release without it is the OS
  // taking the screen (power button) and is how lock is detected while the
  // page is still the foreground app.
  const intentionalReleaseRef = useRef(false);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    const acquire = async () => {
      // Only acquire if video is actually playing and page is visible
      if (!isPlayingRef.current || document.visibilityState !== 'visible') return;
      // Already have an active lock
      if (wakeLockRef.current && !wakeLockRef.current.released) return;

      try {
        const sentinel = await navigator.wakeLock.request('screen');
        wakeLockRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
          if (intentionalReleaseRef.current) {
            intentionalReleaseRef.current = false;
            return;
          }
          markSystemInterrupt();
        });
      } catch {
        // Wake lock request failed (e.g., low battery mode)
      }
    };

    const release = async () => {
      const sentinel = wakeLockRef.current;
      if (!sentinel || sentinel.released) return;
      intentionalReleaseRef.current = true;
      try {
        await sentinel.release();
      } catch {
        intentionalReleaseRef.current = false;
      }
      if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
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
