import { useCallback, useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';

const HIDE_DELAY = 3000;

/**
 * Hides chrome after idle while playing. Pointer move/touch resets the timer.
 * Reel + feed embed (`reelEmbedAutoHide`): only hides auxiliary chrome (play, volume, …);
 * seek bar stays; `controlsVisible` stays true so scrubbing still works.
 */
export function useControlsVisibility() {
  const {
    containerRef,
    state,
    setControlsVisible,
    setReelAuxiliaryChromeVisible,
    isReel,
    reelEmbedAutoHide,
  } = usePlayerContext();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (reelEmbedAutoHide) {
        setReelAuxiliaryChromeVisible(false);
      } else {
        setControlsVisible(false);
      }
    }, HIDE_DELAY);
  }, [reelEmbedAutoHide, setControlsVisible, setReelAuxiliaryChromeVisible]);

  const clearHideTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isReel && !reelEmbedAutoHide) return;

    if (reelEmbedAutoHide) {
      // Reels: never auto-show chrome  the viewer reveals it with a tap.
      // Paused/ended just stops the auto-hide timer; it does NOT pop controls
      // (and would otherwise pop them on every inactive/paused slide).
      if (state.isPaused || state.isEnded) {
        clearHideTimer();
        return;
      }
      scheduleHide();
      return () => clearHideTimer();
    }

    if (state.isPaused || state.isEnded) {
      setControlsVisible(true);
      clearHideTimer();
      return;
    }
    scheduleHide();
    return () => clearHideTimer();
  }, [
    isReel,
    reelEmbedAutoHide,
    state.isPaused,
    state.isEnded,
    state.isPlaying,
    setControlsVisible,
    setReelAuxiliaryChromeVisible,
    scheduleHide,
    clearHideTimer,
  ]);

  useEffect(() => {
    if (isReel && !reelEmbedAutoHide) return;
    const el = containerRef.current;
    if (!el) return;

    const handleMove = () => {
      if (reelEmbedAutoHide) {
        setReelAuxiliaryChromeVisible(true);
      } else {
        setControlsVisible(true);
      }
      if (!state.isPaused && !state.isEnded) {
        scheduleHide();
      }
    };

    const handleLeave = () => {
      if (!state.isPaused && !state.isEnded) {
        clearHideTimer();
        timerRef.current = setTimeout(() => {
          if (reelEmbedAutoHide) {
            setReelAuxiliaryChromeVisible(false);
          } else {
            setControlsVisible(false);
          }
        }, 800);
      }
    };

    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);
    // Reels: no touchstart auto-show  scrolling must not flash controls.
    // (Desktop hover via mousemove is still fine.) Tap-to-reveal is handled
    // by the player's click handler.
    if (!reelEmbedAutoHide) {
      el.addEventListener('touchstart', handleMove, { passive: true });
    }

    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
      el.removeEventListener('touchstart', handleMove);
      clearHideTimer();
    };
  }, [
    isReel,
    reelEmbedAutoHide,
    state.isPaused,
    state.isEnded,
    containerRef,
    setControlsVisible,
    setReelAuxiliaryChromeVisible,
    scheduleHide,
    clearHideTimer,
  ]);
}
