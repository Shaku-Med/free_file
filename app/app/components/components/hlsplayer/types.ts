/** Control names that can be hidden via HideControls */
export type ControlName =
  | 'playPause'
  | 'next'
  | 'volume'
  | 'time'
  | 'subtitles'
  | 'miniPlayer'
  | 'pip'
  | 'cast'
  | 'fullscreen'
  | 'settings'
  | 'theater'
  | 'seek'
  | 'back';

/** When true, the control is hidden */
export type HideControls = Partial<Record<ControlName, boolean>>;

/**
 * Mini player overlay: play/pause + seek + settings (gear renders directly, no kebab).
 * Theater / cast / fullscreen / pip / mini-toggle don't apply at this size.
 */
export const MINI_PLAYER_HIDE_CONTROLS: HideControls = {
  next: true,
  volume: true,
  time: true,
  subtitles: true,
  miniPlayer: true,
  pip: true,
  fullscreen: true,
  theater: true,
  cast: true,
  back: true,
};

/** Vertical PiP / feed embed: keep seek + playback chrome, drop theater / next / cast clutter. */
export const FEED_EMBED_HIDE_CONTROLS: HideControls = {
  theater: true,
  next: true,
  cast: true,
  miniPlayer: true,
  back: true,
};
