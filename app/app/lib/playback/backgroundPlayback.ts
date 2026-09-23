/**
 * Keeping playback alive once the page is hidden.
 *
 * Two pieces live here because both sides of the problem are global: the OS
 * audio session belongs to the document, and a pause the user asked for can
 * arrive from the lock screen while no component is on screen to see it.
 */

/**
 * WebKit's Audio Session API. Declaring `playback` is what tells iOS this page
 * is a media player rather than incidental page sound, and that is the
 * difference between audio surviving a screen lock and being cut off the moment
 * the app leaves the foreground. Safari 16.4+; other engines have no
 * `navigator.audioSession` and manage the session themselves.
 */
type AudioSessionType =
  | 'auto'
  | 'playback'
  | 'transient'
  | 'transient-solo'
  | 'ambient'
  | 'play-and-record';

type AudioSessionNavigator = Navigator & {
  audioSession?: { type: AudioSessionType };
};

export function setAudioSessionType(type: AudioSessionType): void {
  if (typeof navigator === 'undefined') return;
  const session = (navigator as AudioSessionNavigator).audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {
    /* engine rejected the value; it keeps whatever it had */
  }
}

let userPauseAt = 0;
let systemInterruptAt = 0;

/**
 * The screen was locked or the wake lock was taken by the OS, not by a pause
 * the player asked for. Power-button lock often does this while `document.hidden`
 * is still false, so background playback treats a pause in this window as the
 * system's, not the user's.
 */
/** Fired when the OS takes the screen wake lock (power button), not when we release it. */
export const DISPLAY_INTERRUPTED_EVENT = 'memories:display-interrupted';

export function markSystemInterrupt(): void {
  systemInterruptAt = Date.now();
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DISPLAY_INTERRUPTED_EVENT));
}

export function systemInterruptedRecently(withinMs = 1_500): boolean {
  return Date.now() - systemInterruptAt < withinMs;
}

/**
 * The user asked for a pause through the OS: lock screen button, media keys,
 * a headset. Those arrive while the page is hidden and look exactly like the
 * browser's own background pause, so they are recorded here and never fought.
 */
export function markUserPause(): void {
  userPauseAt = Date.now();
}

export function userPausedRecently(withinMs = 1_000): boolean {
  return Date.now() - userPauseAt < withinMs;
}
