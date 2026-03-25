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

/** Hide all controls except the seek bar (for mini player) */
export const HIDE_ALL_EXCEPT_SEEK: HideControls = {
  playPause: true,
  next: true,
  volume: true,
  time: true,
  subtitles: true,
  miniPlayer: true,
  cast: true,
  fullscreen: true,
  settings: true,
  theater: true,
};
