import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';

const HIDE_DELAY = 3000;

export function useControlsVisibility() {
  const { containerRef, state, setControlsVisible, isReel } = usePlayerContext();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setControlsVisible(false), HIDE_DELAY);
  };

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
        if (timerRef.current) clearTimeout(timerRef.current);
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
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.isPaused, state.isEnded, isReel, setControlsVisible]);

  useEffect(() => {
    if (state.isPaused || state.isEnded) {
      setControlsVisible(true);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }, [state.isPaused, state.isEnded, setControlsVisible]);
}
