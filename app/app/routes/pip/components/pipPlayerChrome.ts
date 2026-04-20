import type { HideControls } from '~/components/components/hlsplayer/types';

/** PiP reel iframe: full seek/play/volume, no PiP-in-PiP, cast, theater, or back. */
export const PIP_REEL_HLS_HIDE_CONTROLS: HideControls = {
  next: true,
  subtitles: true,
  miniPlayer: true,
  pip: true,
  cast: true,
  settings: true,
  fullscreen: true,
  theater: true,
  back: true,
};
