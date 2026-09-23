import { useEffect } from 'react';
import { useFileContext } from '~/lib/Context/Context';
import { setAudioSessionType, userPausedRecently } from '~/lib/playback/backgroundPlayback';

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
 * Honours the user's "keep playing in the background" setting.
 *
 * Declares the audio session as playback so iOS lets the sound continue past a
 * screen lock, and puts playback back when the browser pauses it purely because
 * the page went away. A pause the user actually asked for is left alone.
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

    // Claimed on play rather than on mount: `playback` interrupts other apps'
    // audio and overrides the ringer switch, which is only ours to ask for once
    // the user has started something.
    const claimAudioSession = () => {
      if (sessionClaimed) return;
      sessionClaimed = true;
      setAudioSessionType('playback');
    };

    const onVisibility = () => {
      hiddenAt = document.hidden ? Date.now() : 0;
      attempts = 0;
    };

    const onPause = () => {
      // A pause arriving while the page is visible is the user's own; so is one
      // routed through the OS media controls.
      if (!document.hidden) return;
      if (userPausedRecently()) return;
      if (video.ended || video.error) return;
      // Some engines pause before we see visibilitychange, so treat an unset
      // timestamp as "hidden as of now".
      if (!hiddenAt) hiddenAt = Date.now();
      if (Date.now() - hiddenAt > BACKGROUND_PAUSE_WINDOW_MS) return;
      if (attempts >= MAX_RESUME_ATTEMPTS) return;
      attempts += 1;
      void video.play().catch(() => {});
    };

    video.addEventListener('play', claimAudioSession);
    video.addEventListener('pause', onPause);
    document.addEventListener('visibilitychange', onVisibility);
    if (!video.paused) claimAudioSession();

    return () => {
      video.removeEventListener('play', claimAudioSession);
      video.removeEventListener('pause', onPause);
      document.removeEventListener('visibilitychange', onVisibility);
      if (sessionClaimed) setAudioSessionType('auto');
    };
  }, [enabled, videoRef]);
}
