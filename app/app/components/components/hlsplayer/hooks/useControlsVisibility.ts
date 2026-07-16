import { useCallback, useEffect, useRef } from 'react';
import { useGlobalPlayerLayout } from '~/lib/Context/GlobalPlayerLayoutContext';
import { usePlayerContext } from '../PlayerContext';

const HIDE_DELAY = 3000;

/**
 * Hides chrome after idle while playing. Pointer move/touch resets the timer.
 * Reel + feed embed (`reelEmbedAutoHide`) and floating mini dock: only hides
 * auxiliary chrome (play, volume, …); seek bar stays; `controlsVisible` stays
 * true so scrubbing still works.
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
  const layout = useGlobalPlayerLayout();
  /** Mini dock: same seek-always / chrome-hides pattern as reel embeds. */
  const miniSeekAlways = layout === 'mini';
  const hideAuxOnly = reelEmbedAutoHide || miniSeekAlways;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (hideAuxOnly) {
        setReelAuxiliaryChromeVisible(false);
      } else {
        setControlsVisible(false);
      }
    }, HIDE_DELAY);
  }, [hideAuxOnly, setControlsVisible, setReelAuxiliaryChromeVisible]);

  const clearHideTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isReel && !reelEmbedAutoHide) return;

    if (reelEmbedAutoHide) {
      // Reels: never auto-show chrome — the viewer reveals it with a tap.
      // Paused/ended just stops the auto-hide timer; it does NOT pop controls
      // (and would otherwise pop them on every inactive/paused slide).
      if (state.isPaused || state.isEnded) {
        clearHideTimer();
        return;
      }
      scheduleHide();
      return () => clearHideTimer();
    }

    if (miniSeekAlways) {
      // Keep `controlsVisible` true so the always-on seek bar can scrub and
      // captions keep their control reserve. Only auxiliary chrome hides.
      setControlsVisible(true);
      if (state.isPaused || state.isEnded) {
        setReelAuxiliaryChromeVisible(true);
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
    miniSeekAlways,
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

    const showChrome = () => {
      if (hideAuxOnly) {
        setReelAuxiliaryChromeVisible(true);
        if (miniSeekAlways) setControlsVisible(true);
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
          if (hideAuxOnly) {
            setReelAuxiliaryChromeVisible(false);
          } else {
            setControlsVisible(false);
          }
        }, 800);
      }
    };

    // Mini dock repositions every frame while scrolling; `mousemove` under a
    // moving element can spam and keep chrome stuck visible. Use enter/leave.
    if (miniSeekAlways) {
      el.addEventListener('mouseenter', showChrome);
      el.addEventListener('mouseleave', handleLeave);
      el.addEventListener('touchstart', showChrome, { passive: true });
      return () => {
        el.removeEventListener('mouseenter', showChrome);
        el.removeEventListener('mouseleave', handleLeave);
        el.removeEventListener('touchstart', showChrome);
        clearHideTimer();
      };
    }

    el.addEventListener('mousemove', showChrome);
    el.addEventListener('mouseleave', handleLeave);
    // Reels: no touchstart auto-show — scrolling must not flash controls.
    // (Desktop hover via mousemove is still fine.) Tap-to-reveal is handled
    // by the player's click handler.
    if (!reelEmbedAutoHide) {
      el.addEventListener('touchstart', showChrome, { passive: true });
    }

    return () => {
      el.removeEventListener('mousemove', showChrome);
      el.removeEventListener('mouseleave', handleLeave);
      el.removeEventListener('touchstart', showChrome);
      clearHideTimer();
    };
  }, [
    isReel,
    reelEmbedAutoHide,
    miniSeekAlways,
    hideAuxOnly,
    state.isPaused,
    state.isEnded,
    containerRef,
    setControlsVisible,
    setReelAuxiliaryChromeVisible,
    scheduleHide,
    clearHideTimer,
  ]);
}
