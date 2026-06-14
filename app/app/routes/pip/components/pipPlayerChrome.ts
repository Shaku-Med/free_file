import type { HideControls } from '~/components/components/hlsplayer/types';

/**
 * Reel chrome (PiP iframe + /reel page). Shorts-style: play/pause + volume live
 * in the top-left cluster (see hlsplayer/index.tsx), so the bottom bar keeps ONLY
 * the thin seek/progress bar — no duplicate play/pause, volume, or time there.
 */
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
  playPause: true,
  volume: true,
  time: true,
};
