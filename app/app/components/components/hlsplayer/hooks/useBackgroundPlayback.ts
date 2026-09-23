import { useEffect } from 'react';
import { useFileContext } from '~/lib/Context/Context';
import {
  DISPLAY_INTERRUPTED_EVENT,
  setAudioSessionType,
  systemInterruptedRecently,
  userPausedRecently,
} from '~/lib/playback/backgroundPlayback';

/**
 * How long after the page hides a pause still counts as the browser's own
 * background pause rather than a deliberate one. Generous because engines differ
 * on when they cut playback; intent is guarded by `userPausedRecently` instead of
 * by a tight window.
 */
const BACKGROUND_PAUSE_WINDOW_MS = 5_000;

/** Bounded so an engine that refuses to resume can't spin while backgrounded. */
const MAX_RESUME_ATTEMPTS = 3;

/**
 * How long a pause waits for a sign that the display went away before we accept
 * it as deliberate. Long enough for a wake lock release or a blur that lands
 * just after the pause, short enough that a later unrelated blur cannot restart
 * something the app stopped on purpose.
 */
const PAUSE_SETTLE_MS = 800;

/**
 * Honours the user's "keep playing in the background" setting.
 *
 * Declares the audio session as playback so iOS lets the sound continue past a
 * screen lock, and puts playback back when the browser pauses it on its own.
 * A pause the user actually asked for is left alone.
 *
 * Leaving the app hides the page first, so the pause arrives with
 * `document.hidden` already set. The power button does not: it turns the
 * display off while this app is still the foreground app, pauses the element
 * while the page is still "visible", and only afterwards (if at all) flips
 * visibility. Resume has to run on that pause, not only once the page is hidden.
 */
export function useBackgroundPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
) {
  const { playerSettings } = useFileContext();
  const enabled = active && playerSettings?.backgroundPlayback === true;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const video = videoRef.current;
    if (!video) return;

    let sessionClaimed = false;
    let hiddenAt = 0;
    let attempts = 0;
    let settleTimer = 0;
    // True only after the user (or autoplay) has actually started this element.
    // A system pause must not be what starts playback.
    let wantPlaying = !video.paused;

    // Claimed on play rather than on mount: `playback` interrupts other apps'
    // audio and overrides the ringer switch, which is only ours to ask for once
    // the user has started something.
    const claimAudioSession = () => {
      if (sessionClaimed) return;
      sessionClaimed = true;
      setAudioSessionType('playback');
    };

    const userOptedOut = () =>
      video.dataset.userPaused === '1' || userPausedRecently();

    // Power-button lock often leaves `document.hidden` false: the app was not
    // backgrounded, the screen just went off, and the window has lost focus.
    // The wake lock release is the same moment, even when visibility never flips.
    const displayInterrupted = () =>
      document.hidden || !document.hasFocus() || systemInterruptedRecently();

    const resume = () => {
      if (!wantPlaying || userOptedOut()) return;
      if (video.ended || video.error || !video.paused) return;
      if (attempts >= MAX_RESUME_ATTEMPTS) return;
      attempts += 1;
      void video.play().catch(() => {});
    };

    const onPlay = () => {
      wantPlaying = true;
      window.clearTimeout(settleTimer);
      // Only a play we are not fighting for earns a fresh budget. Resetting on
      // every play lets a surface that re-pauses us on sight, the way PiP holds
      // the main player down, ping pong forever with the screen off.
      if (!displayInterrupted()) attempts = 0;
      claimAudioSession();
    };

    const onVisibility = () => {
      if (document.hidden) {
        const becameHidden = hiddenAt === 0;
        hiddenAt = Date.now();
        // The pause may already have been ignored while we were still visible.
        if (becameHidden) attempts = 0;
        resume();
        return;
      }
      hiddenAt = 0;
      attempts = 0;
    };

    const onPause = () => {
      if (userOptedOut()) {
        wantPlaying = false;
        return;
      }
      if (!wantPlaying || video.ended || video.error) return;
      // Some engines pause before we see visibilitychange, so treat an unset
      // timestamp as "hidden as of now".
      if (document.hidden && !hiddenAt) hiddenAt = Date.now();
      if (document.hidden && Date.now() - hiddenAt > BACKGROUND_PAUSE_WINDOW_MS) return;
      if (displayInterrupted()) {
        resume();
        return;
      }
      // Hidden can flip in the same turn, just after this listener returns.
      // A timer is only a backup: a lock can freeze the page before it runs,
      // which is why visibility / blur / freeze resume on their own.
      window.setTimeout(() => {
        if (displayInterrupted()) resume();
      }, 0);
      // Nothing took the display a moment later means the app stopped us on
      // purpose: PiP adopting the video, autoplay off, a reel scrolled away.
      // Drop the intent so an unrelated blur later cannot start it again.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (video.paused && !displayInterrupted()) wantPlaying = false;
      }, PAUSE_SETTLE_MS);
    };

    // Screen lock blurs the window even on engines that never mark the page hidden.
    const onBlur = () => {
      if (video.paused) resume();
    };

    const onFreeze = () => {
      attempts = 0;
      resume();
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('freeze', onFreeze);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onFreeze);
    window.addEventListener(DISPLAY_INTERRUPTED_EVENT, onBlur);
    if (!video.paused) claimAudioSession();

    return () => {
      window.clearTimeout(settleTimer);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('freeze', onFreeze);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onFreeze);
      window.removeEventListener(DISPLAY_INTERRUPTED_EVENT, onBlur);
      if (sessionClaimed) setAudioSessionType('auto');
    };
  }, [enabled, videoRef]);
}
