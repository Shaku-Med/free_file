/** Control names that can be hidden via HideControls */
export type ControlName =
  | 'playPause'
  | 'next'
  | 'volume'
  | 'time'
  | 'subtitles'
  | 'miniPlayer'
  | 'cast'
  | 'fullscreen'
  | 'settings'
  | 'theater'
  | 'seek';

/** When true, the control is hidden */
export type HideControls = Partial<Record<ControlName, boolean>>;

/**
 * Mini player overlay: only play/pause and AirPlay (cast).
 * Seek bar and skip buttons are hidden.
 */
export const MINI_PLAYER_HIDE_CONTROLS: HideControls = {
  seek: true,
  next: true,
  volume: true,
  time: true,
  subtitles: true,
  miniPlayer: true,
  fullscreen: true,
  settings: true,
  theater: true,
};
