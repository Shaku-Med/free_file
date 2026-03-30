import { useCallback, useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';

const HIDE_DELAY = 3000;

/**
 * Hides chrome after idle while playing. Pointer move/touch resets the timer.
 * Also schedules hide when playback is active even with no pointer movement (fixes “must move mouse first”).
 */
export function useControlsVisibility() {
  const { containerRef, state, setControlsVisible, isReel } = usePlayerContext();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setControlsVisible(false), HIDE_DELAY);
  }, [setControlsVisible]);

  const clearHideTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Pause / end: keep controls visible. Playing: start hide timer without requiring pointer events.
  useEffect(() => {
    if (isReel) return;
    if (state.isPaused || state.isEnded) {
      setControlsVisible(true);
      clearHideTimer();
      return;
    }
    scheduleHide();
    return () => clearHideTimer();
  }, [
    isReel,
    state.isPaused,
    state.isEnded,
    state.isPlaying,
    setControlsVisible,
    scheduleHide,
    clearHideTimer,
  ]);

  useEffect(() => {
    if (isReel) return;
    const el = containerRef.current;
    if (!el) return;

    const handleMove = () => {
      setControlsVisible(true);
      if (!state.isPaused && !state.isEnded) {
        scheduleHide();
      }
    };

    const handleLeave = () => {
      if (!state.isPaused && !state.isEnded) {
        clearHideTimer();
        timerRef.current = setTimeout(() => setControlsVisible(false), 800);
      }
    };

    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);
    el.addEventListener('touchstart', handleMove, { passive: true });

    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
      el.removeEventListener('touchstart', handleMove);
      clearHideTimer();
    };
  }, [isReel, state.isPaused, state.isEnded, setControlsVisible, scheduleHide, clearHideTimer]);
}
